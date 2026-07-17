FROM node:18-slim

WORKDIR /app

# Copiamos los package antes del resto del código
COPY package*.json ./

# Instalamos de forma limpia para producción (evita conflictos de dependencias locales)
RUN npm ci --include=dev

# Copiamos el resto de los archivos (respetando el .dockerignore que creamos)
COPY . .

# Exponemos el puerto
EXPOSE 3001

# Forzamos la ejecución
CMD ["node", "socket-server.js"]