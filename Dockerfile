# Use a stable and lightweight base image
FROM node:20-bookworm-slim

# Install necessary build tools (required for native dependencies like sharp/onnxruntime)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (use npm install instead of npm ci for better compatibility)
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
