# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container to /app
WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json and package-lock.json are copied
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the entire application source code to the container
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
