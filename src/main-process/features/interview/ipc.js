'use strict';

const { extractDocumentText } = require('./document-text');
const { parseQaText } = require('./qa-bank');

const DOCUMENT_FILTERS = [{ name: 'Documents', extensions: ['pdf', 'txt', 'md'] }];

function summarizeSession(stores) {
  const events = stores.getEvents();
  return {
    questions: events.filter((event) => event.kind === 'host').length,
    answers: events.filter((event) => event.kind === 'answer').length,
    spokenAnswers: stores.getSpokenAnswers({ limit: 1000 }).length,
    lastActivity: events.length ? new Date(events[events.length - 1].t).toISOString() : null
  };
}

function registerInterviewIpc({ ipcMain, dialog, getMainWindow, stores, engine }) {
  async function pickDocument(title) {
    const result = await dialog.showOpenDialog(getMainWindow() || undefined, {
      title,
      properties: ['openFile'],
      filters: DOCUMENT_FILTERS
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  }

  ipcMain.handle('interview-get-state', () => ({
    profile: stores.getProfile(),
    bank: { count: stores.getBank().pairs.length, source: stores.getBank().source },
    session: summarizeSession(stores)
  }));

  ipcMain.handle('interview-save-profile', (_event, profile = {}) => {
    try {
      return { success: true, profile: stores.saveProfile(profile) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // kind: 'resume' | 'jobDescription' -> returns the text for the form field.
  ipcMain.handle('interview-import-text', async (_event, kind) => {
    try {
      const filePath = await pickDocument(kind === 'resume' ? 'Choose your resume' : 'Choose the job description');
      if (!filePath) return { success: false, canceled: true };
      const text = (await extractDocumentText(filePath)).trim();
      if (!text) return { success: false, error: 'No text found in that file (is it a scanned image?).' };
      return { success: true, text };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('interview-import-qa', async () => {
    try {
      const filePath = await pickDocument('Choose your prepared Q&A');
      if (!filePath) return { success: false, canceled: true };
      const pairs = parseQaText(await extractDocumentText(filePath));
      if (pairs.length === 0) {
        return {
          success: false,
          error: 'No questions found. Put each question on its own line starting with "Q:" (or ending in "?") and the answer below it.'
        };
      }
      stores.saveBank(pairs, filePath.split(/[\\/]/).pop());
      engine.reloadBank();
      return { success: true, count: pairs.length, sample: pairs.slice(0, 3).map((pair) => pair.question) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('interview-clear-session', () => {
    engine.stop();
    stores.clearSession();
    return { success: true, session: summarizeSession(stores) };
  });

  ipcMain.handle('interview-answer-last-question', async () => {
    const result = await engine.answerLastQuestion();
    return { success: !result.error, ...result };
  });
}

module.exports = {
  registerInterviewIpc,
  summarizeSession
};
