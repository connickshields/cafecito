# Cafecito
## Overview

Cafecito is a web application that was created to help me track orders when running neighborhood pop-up coffee events. It's built using Svelte for the frontend, Vite as the build tool, and Supabase for backend services.

## Getting Started

### Prerequisites

- Node.js (version 14 or later)
- npm or yarn
- Supabase account and project set up
    - At least one Supabase user defined for barista dashboard access

### Installation

1. Clone the repository:

2. Install dependencies:
   - `npm install` or `yarn install`

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your Supabase URL and anon key in the `.env` file

4. Apply migrations:
- Use the `schema.sql`and `rls.sql` files to apply database migrations in your Supabase project.

### Development

To run the project in development mode:
- `npm run dev` or `yarn dev`