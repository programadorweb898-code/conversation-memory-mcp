# Use a stable and complete base image
FROM node:20-bookworm

# Install ALL build tools and sqlite development libraries
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    sqlite3 \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Set environment variables for node-gyp
ENV PYTHON=/usr/bin/python3

# Copy package files
COPY package*.json ./

# Install dependencies
# We build from source to ensure compatibility with the container's GLIBC
RUN npm install --build-from-source

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
