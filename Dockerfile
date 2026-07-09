# Use official lightweight Node.js active LTS image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package configurations and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source files
COPY src/ ./src/
COPY public/ ./public/
COPY schema.sql ./

# Expose the application port
EXPOSE 8038

# Start the application directly (relying on Docker Compose or container runtime for environment variables)
CMD ["node", "src/index.js"]
