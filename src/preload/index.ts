import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppState } from '../shared/api';

const api: Api = {
	state: () => ipcRenderer.invoke('state'),
	addProject: () => ipcRenderer.invoke('addProject'),
	removeProject: (path) => ipcRenderer.invoke('removeProject', path),
	setActive: (path) => ipcRenderer.invoke('setActive', path),
	move: (path, id, to) => ipcRenderer.invoke('move', path, id, to),
	close: (path, id) => ipcRenderer.invoke('close', path, id),
	reviewed: (path, key) => ipcRenderer.invoke('reviewed', path, key),
	open: (path, href, from) => ipcRenderer.invoke('open', path, href, from),
	chooseRulesDir: () => ipcRenderer.invoke('chooseRulesDir'),
	openRules: () => ipcRenderer.invoke('openRules'),
	setTheme: (dark) => ipcRenderer.invoke('setTheme', dark),
	copy: (text) => ipcRenderer.invoke('copy', text),
	launch: (path, id) => ipcRenderer.invoke('launch', path, id),
	toMain: (path, worktree) => ipcRenderer.invoke('toMain', path, worktree),
	timeLog: (path) => ipcRenderer.invoke('timeLog', path),
	onState: (cb) => {
		const listener = (_e: unknown, state: AppState) => cb(state);
		ipcRenderer.on('state', listener);
		return () => ipcRenderer.off('state', listener);
	},
};

contextBridge.exposeInMainWorld('api', api);
