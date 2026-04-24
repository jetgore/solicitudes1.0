const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Opcional: agregar icono
    show: false, // Ocultar hasta que esté listo
  });

  // Cargar el archivo HTML principal
  mainWindow.loadFile(path.join(__dirname, 'index_2_1.html'));

  // Ocultar barra de menú
  mainWindow.setMenuBarVisibility(false);

  // Mostrar ventana cuando esté lista
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Manejar cierre
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Desactivar devtools en producción
  if (process.env.NODE_ENV === 'production') {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});