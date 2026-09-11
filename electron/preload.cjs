const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  call: async (method, payload) => {
    const response = await ipcRenderer.invoke("desktop:call", method, payload);
    if (!response.ok) throw new Error(response.error);
    return response.value;
  },
});
