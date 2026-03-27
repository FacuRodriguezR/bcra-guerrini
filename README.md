# BCRA-GUERRINI

Este proyecto ha sido desarrollado utilizando **Angular 21** y **Git** como sistema de control de versiones. 

---

## 📝 Descripción del Proyecto
Este proyecto es una aplicación web moderna (ej. Landing Page para Asistéril) desarrollada con Angular, enfocada en la eficiencia y la escalabilidad de componentes.

---

## 🚀 Instalación

Una vez que hayas descargado o clonado el repositorio mediante **Git**, es necesario instalar las dependencias del proyecto que se encuentran definidas en el archivo `package.json`.

Para generar la carpeta `node_modules`, ejecuta el siguiente comando en tu terminal:

```bash
npm install

```
## Servidor de desarrollo

Para levantar la aplicación en un entorno local, es obligatorio utilizar la configuración de proxy definida para que las peticiones a la API funcionen correctamente:

```bash
ng serve --proxy-config proxy.conf.json

 ```

## Acceso Remoto o Red Local

Si necesitás levantar el proyecto y que sea accesible desde otro dispositivo en la misma red (o simplemente especificar un puerto diferente), podés utilizar el siguiente comando:

```bash
ng serve --proxy-config proxy.conf.json --host 0.0.0.0 --port 3030

 ```

 ## 🛠 Build
 Para generar los archivos de producción listos para el despliegue (se guardarán en la carpeta dist/):

 ```bash
ng build

 ```

## 🎨 Componentes de UI y Estilos

Este proyecto utiliza Angular Material para componentes interactivos clave y Tailwind CSS para un estilizado basado en utilidades, asegurando una estética consistente y moderna.

>Configuración de Tailwind: Los temas personalizados y colores de marca para Asistéril están definidos en tailwind.config.js.

>Temas de Material: Integrados mediante @angular/material para patrones de UI accesibles y de alta calidad.
