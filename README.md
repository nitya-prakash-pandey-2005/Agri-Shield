# Agri-SHIELD

**Climate Decision Intelligence for the Next Billion Farmers.**

Built for the Asian Hackathon for Green Future 2026. Agri-SHIELD is a production-grade SaaS platform that translates complex climate models into actionable, role-specific intelligence for farmers, governments, and supply chain operators.

## Architecture

This is a modern, full-stack monorepo built with Turborepo.

- **Frontend:** Next.js 14 App Router, React 19, TailwindCSS, Framer Motion
- **ML API:** Python FastAPI, Scikit-learn, LangChain
- **Database:** PostgreSQL + PostGIS (via Drizzle ORM)
- **Background Jobs:** BullMQ + Redis
- **Real-time:** Socket.io + Twilio/FCM
- **Maps:** Leaflet / Mapbox GL JS

## Project Structure

- `apps/web` - Main Next.js frontend application (Farmer, Gov, Supply Chain portals)
- `apps/ml-api` - Python FastAPI backend for ML models and RAG advisor
- `packages/db` - Database schema and Drizzle ORM configuration
- `packages/ui` - Shared UI components
- `packages/types` - Shared TypeScript types
- `packages/i18n` - Internationalization JSON files
- `scripts` - Database seeding and deployment scripts

## Getting Started

### Prerequisites
- Node.js (v20+)
- pnpm (v9+)
- Python (v3.10+)
- PostgreSQL (v15+) with PostGIS extension
- Redis (optional, for background workers)

### Local Development

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up environment variables:
   Copy `.env.example` to `.env` in the root and in respective apps.

3. Start local infrastructure (Postgres, Redis):
   ```bash
   docker-compose up -d
   ```

4. Push database schema:
   ```bash
   pnpm --filter @agri-shield/db db:push
   ```

5. Seed database with demo data:
   ```bash
   pnpm run db:seed
   ```

6. Start Python ML API:
   ```bash
   cd apps/ml-api
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

7. Start Next.js frontend with Socket.io:
   ```bash
   cd apps/web
   pnpm run dev:custom
   ```

Visit `http://localhost:3000` to access the platform.
