#!/bin/bash
# Vercel build script to ensure Prisma is properly set up

echo "🔧 Installing dependencies..."
npm install

echo "📦 Generating Prisma Client..."
npx prisma generate

echo "✅ Build complete!"
