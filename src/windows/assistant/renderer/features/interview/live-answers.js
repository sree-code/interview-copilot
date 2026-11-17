// Shows answers from the main-process answer engine (fast mode): prepared
// answers appear at once, model answers stream in, and an answer the
// interviewer interrupted is marked as such.

const ACTION_ID = 'autoAnswer';

export function createLiveAnswerView({ addChatMessage, updateChatMessageContent, hideLoadingOverlay }) {
    const answers = new Map(); // answerId -> { messageId, header, text }

    function render(entry, suffix = '') {
        updateChatMessageContent(entry.messageId, `${entry.header}${entry.text}${suffix}`);
    }

    function bind() {
        window.electronAPI.onAiStreamStart?.((data) => {
            if (data?.actionId !== ACTION_ID) return;
            const header = `**${data.label || 'Suggested answer'}**\n`;
            const record = addChatMessage('ai-response', `${header}…`);
            answers.set(data.answerId, { messageId: record?.id, header, text: '' });
        });

        window.electronAPI.onAiStreamChunk?.((data) => {
            if (data?.actionId !== ACTION_ID) return;
            const entry = answers.get(data.answerId);
            if (!entry?.messageId) return;
            entry.text += data.text;
            render(entry);
            hideLoadingOverlay?.();
        });

        window.electronAPI.onAiStreamEnd?.((data) => {
            if (data?.actionId !== ACTION_ID) return;
            const entry = answers.get(data.answerId);
            if (data.error) {
                if (entry?.messageId) render(entry, `\n_${data.error}_`);
                else addChatMessage('system', `Live answer failed: ${data.error}`);
            } else if (entry?.messageId && data.interrupted) {
                render(entry, '\n_(interrupted, answering the follow-up)_');
            }
            answers.delete(data.answerId);
        });
    }

    return { bind };
}
