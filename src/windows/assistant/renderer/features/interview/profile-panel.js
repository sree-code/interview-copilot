// Interview profile form in the Settings panel: your details, the target
// job, resume, prepared Q&A import, fast mode and the running session.

export function createInterviewProfilePanel({ showFeedback, onFastModeChanged }) {
    const $ = (id) => document.getElementById(id);
    const fields = {
        name: $('profile-name'),
        currentRole: $('profile-current-role'),
        targetCompany: $('profile-target-company'),
        targetRole: $('profile-target-role'),
        jobDescription: $('profile-job-description'),
        resumeText: $('profile-resume'),
        notes: $('profile-notes')
    };
    const fastMode = $('profile-fast-mode');
    const qaStatus = $('profile-qa-status');
    const sessionStatus = $('profile-session-status');

    function renderSession(session) {
        if (!sessionStatus || !session) return;
        sessionStatus.textContent = session.questions === 0
            ? 'New session. Questions and answers are kept here across restarts.'
            : `Continuing your session: ${session.questions} interviewer lines, ${session.answers} answers, `
              + `${session.spokenAnswers} of your own spoken answers used to match your style.`;
    }

    function renderBank(bank) {
        if (!qaStatus || !bank) return;
        qaStatus.textContent = bank.count > 0
            ? `${bank.count} prepared answers loaded${bank.source ? ` from ${bank.source}` : ''}. These are used first.`
            : 'No prepared answers loaded.';
    }

    async function load() {
        const state = await window.electronAPI.interviewGetState();
        if (!state || state.error) return null;
        for (const [key, element] of Object.entries(fields)) {
            if (element) element.value = state.profile[key] || '';
        }
        if (fastMode) fastMode.checked = Boolean(state.profile.fastMode);
        renderBank(state.bank);
        renderSession(state.session);
        onFastModeChanged?.(Boolean(state.profile.fastMode));
        return state;
    }

    function read() {
        const profile = {};
        for (const [key, element] of Object.entries(fields)) {
            profile[key] = element ? element.value : '';
        }
        profile.fastMode = Boolean(fastMode?.checked);
        return profile;
    }

    async function save() {
        const result = await window.electronAPI.interviewSaveProfile(read());
        if (result?.success) {
            showFeedback?.('Profile saved', 'success');
            onFastModeChanged?.(Boolean(result.profile.fastMode));
        } else {
            showFeedback?.(`Profile not saved: ${result?.error || 'unknown error'}`, 'error');
        }
    }

    async function importInto(kind, element) {
        const result = await window.electronAPI.interviewImportText(kind);
        if (result?.success && element) {
            element.value = result.text;
            showFeedback?.('Imported. Click Save Profile to keep it.', 'info');
        } else if (result && !result.canceled) {
            showFeedback?.(result.error || 'Import failed', 'error');
        }
    }

    function bind() {
        $('save-profile-btn')?.addEventListener('click', save);
        fastMode?.addEventListener('change', save);
        $('profile-import-resume')?.addEventListener('click', () => importInto('resume', fields.resumeText));
        $('profile-import-jd')?.addEventListener('click', () => importInto('jobDescription', fields.jobDescription));
        $('profile-import-qa')?.addEventListener('click', async () => {
            const result = await window.electronAPI.interviewImportQa();
            if (result?.success) {
                renderBank({ count: result.count });
                showFeedback?.(`Loaded ${result.count} prepared answers`, 'success');
            } else if (result && !result.canceled) {
                showFeedback?.(result.error || 'Import failed', 'error');
            }
        });
        $('profile-clear-session')?.addEventListener('click', async () => {
            const result = await window.electronAPI.interviewClearSession();
            if (result?.success) {
                renderSession(result.session);
                showFeedback?.('Started a fresh session', 'info');
            }
        });
    }

    return { bind, load };
}
