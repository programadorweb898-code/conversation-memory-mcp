# Use a more recent Node.js runtime
FROM node:20

# Install build dependencies and system sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies forcing build from source to match container's GLIBC
# We use the system sqlite3 library to avoid common compilation issues
RUN npm install --build-from-source --sqlite=/usr

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
