# Use a stable and lightweight base image
FROM node:20-bookworm-slim

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
