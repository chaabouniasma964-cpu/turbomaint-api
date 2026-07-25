# ---- Site React TurboMaint : build en 2 étapes (multi-stage) ----
# Étape 1 : compilation avec Node ; Étape 2 : service statique via nginx
# (l'image finale ne contient ni Node ni node_modules).

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# URL de l'API injectée au build (Vite fige les variables VITE_* dans le bundle).
# Vue depuis le navigateur Windows via la redirection de port -> localhost:7860
ARG VITE_API_URL=http://localhost:7860
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
# Config nginx avec fallback SPA (React Router : /portail, /console… -> index.html)
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
