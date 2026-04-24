# Sistema TI - Aplicación de Escritorio

## Instalación

1. Instalar Node.js (versión 16 o superior)
2. Clonar o copiar el proyecto
3. Ejecutar: `npm install`

## Desarrollo

Para ejecutar en modo desarrollo:
```
npm start
```

## Compilación

Para generar el instalador .exe:
```
npm run build
```

El instalador se generará en la carpeta `dist/`.

## Icono (Opcional)

Colocar `icon.ico` en la carpeta `assets/` para personalizar el icono de la aplicación.

## Notas

- La aplicación carga `index_2_1.html` como página principal
- Configurada para Windows con instalador NSIS
- DevTools desactivados en producción