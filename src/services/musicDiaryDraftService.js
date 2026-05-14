let currentMusicDiaryDraft = null;

export function setMusicDiaryDraft(record = {}, track = null) {
  const draftId = `music-diary-${Date.now()}`;
  currentMusicDiaryDraft = {
    id: draftId,
    record,
    track,
  };
  return draftId;
}

export function getMusicDiaryDraft(draftId = '') {
  if (!currentMusicDiaryDraft) {
    return null;
  }
  if (draftId && currentMusicDiaryDraft.id !== draftId) {
    return null;
  }
  return currentMusicDiaryDraft;
}
