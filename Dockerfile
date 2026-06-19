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

# Install only production dependencies for faster and more stable builds
RUN npm ci --only=production

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
