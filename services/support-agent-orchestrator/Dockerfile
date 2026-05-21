FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY playbooks ./playbooks

EXPOSE 3015
CMD ["npm", "start"]
