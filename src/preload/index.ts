import { contextBridge, ipcRenderer } from 'electron'
import { channels, events, type Api, type MobileImageEvent, type MobileStoppedEvent, type ProgressEvent } from '../shared/api'

// Solo se expone la API tipada; ipcRenderer nunca llega al renderer.
const api: Api = {
  subjects: {
    list: () => ipcRenderer.invoke(channels.subjectsList),
    create: (name) => ipcRenderer.invoke(channels.subjectsCreate, name)
  },
  notes: {
    import: (subjectId, kind) => ipcRenderer.invoke(channels.notesImport, subjectId, kind),
    confirmOcr: (documentId, correctedText, force) =>
      ipcRenderer.invoke(channels.notesConfirmOcr, documentId, correctedText, force),
    list: (subjectId) => ipcRenderer.invoke(channels.notesList, subjectId),
    chunks: (subjectId, documentId) => ipcRenderer.invoke(channels.notesChunks, subjectId, documentId),
    chunk: (subjectId, chunkId) => ipcRenderer.invoke(channels.notesChunk, subjectId, chunkId),
    deleteDocument: (subjectId, documentId) => ipcRenderer.invoke(channels.notesDeleteDocument, subjectId, documentId)
  },
  quiz: {
    generate: (req) => ipcRenderer.invoke(channels.quizGenerate, req),
    cancel: (requestId) => ipcRenderer.invoke(channels.quizCancel, requestId),
    onProgress: (cb) => {
      const listener = (_e: unknown, payload: ProgressEvent): void => cb(payload)
      ipcRenderer.on(events.quizProgress, listener)
      return () => {
        ipcRenderer.removeListener(events.quizProgress, listener)
      }
    },
    startAttempt: (subjectId) => ipcRenderer.invoke(channels.quizStartAttempt, subjectId),
    finishAttempt: (subjectId, attemptId) => ipcRenderer.invoke(channels.quizFinishAttempt, subjectId, attemptId),
    submit: (req) => ipcRenderer.invoke(channels.quizSubmit, req)
  },
  history: {
    list: (subjectId) => ipcRenderer.invoke(channels.historyList, subjectId)
  },
  concepts: {
    list: (subjectId) => ipcRenderer.invoke(channels.conceptsList, subjectId),
    build: (req) => ipcRenderer.invoke(channels.conceptsBuild, req),
    cancel: (requestId) => ipcRenderer.invoke(channels.conceptsCancel, requestId),
    onProgress: (cb) => {
      const listener = (_e: unknown, payload: ProgressEvent): void => cb(payload)
      ipcRenderer.on(events.conceptsProgress, listener)
      return () => {
        ipcRenderer.removeListener(events.conceptsProgress, listener)
      }
    }
  },
  mobile: {
    start: (req) => ipcRenderer.invoke(channels.mobileStart, req),
    stop: () => ipcRenderer.invoke(channels.mobileStop),
    onImage: (cb) => {
      const listener = (_e: unknown, payload: MobileImageEvent): void => cb(payload)
      ipcRenderer.on(events.mobileImage, listener)
      return () => {
        ipcRenderer.removeListener(events.mobileImage, listener)
      }
    },
    onStopped: (cb) => {
      const listener = (_e: unknown, payload: MobileStoppedEvent): void => cb(payload)
      ipcRenderer.on(events.mobileStopped, listener)
      return () => {
        ipcRenderer.removeListener(events.mobileStopped, listener)
      }
    }
  },
  system: {
    health: () => ipcRenderer.invoke(channels.systemHealth),
    config: () => ipcRenderer.invoke(channels.systemConfig)
  }
}

contextBridge.exposeInMainWorld('api', api)
