# Use a stable and lightweight base image
FROM node:20-bookworm-slim

# Install necessary build tools and sqlite development libraries
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# --- CORRECCIÓN CRÍTICA ---
# Forzar la recompilación de sqlite3 desde el código fuente para asegurar compatibilidad con GLIBC del sistema
RUN npm rebuild sqlite3 --build-from-source

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
