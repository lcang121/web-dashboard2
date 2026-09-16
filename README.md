# Web Dashboard

A modern React-based dashboard application for managing transactions, reports, and business analytics with Firebase integration.

## Features

- **Authentication System**: Secure Firebase authentication with protected routes
- **Reports Dashboard**: Comprehensive reporting system with multiple view types
  - Daily reports and analytics
  - Transaction management and tracking
  - Refunds and returns processing
  - Custom report generation
  - Manual transaction entry
- **Data Export**: Export reports to Excel (XLSX) format
- **Responsive Design**: Built with Tailwind CSS for mobile-first responsive design
- **Real-time Data**: Firebase integration for real-time data synchronization

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Backend**: Firebase (Authentication, Database)
- **Routing**: React Router DOM
- **Icons**: Lucide React
- **Date/Time**: Moment.js with timezone support
- **Testing**: Vitest with React Testing Library
- **Data Export**: XLSX library for Excel exports

## Prerequisites

- Node.js (version 18 or higher recommended)
- npm or yarn
- Firebase project setup

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd web-dashboard
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your Firebase configuration:

   ```env
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
   VITE_FIREBASE_DATABASE_URL=your_firebase_database_url
   VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_firebase_app_id
   ```

For Vercel, add these same `VITE_FIREBASE_*` variables under Project Settings > Environment Variables for each environment, then redeploy.

## Available Scripts

- **Development**: Start the development server

  ```bash
  npm run dev
  ```

- **Build**: Create production build

  ```bash
  npm run build
  ```

- **Preview**: Preview production build locally

  ```bash
  npm run preview
  ```

- **Test**: Run tests
  ```bash
  npm test
  ```

## Project Structure

```
src/
├── components/          # Reusable UI components
│   └── ProtectedRoute.tsx
├── contexts/           # React contexts
│   └── AuthContext.tsx
├── config/            # Configuration files
│   └── firebase.ts
├── layouts/           # Layout components
│   └── DashboardLayout.tsx
├── models/            # TypeScript models/interfaces
│   └── Transaction.ts
├── modules/           # Feature modules
│   └── reports/       # Reports module
│       ├── ReportsPage.tsx
│       ├── Comps/     # Report components
│       └── hooks/     # Report-specific hooks
├── pages/             # Page components
│   └── LoginPage.tsx
├── utils/             # Utility functions
│   └── exportUtils.ts
├── App.tsx           # Main app component
├── main.tsx          # App entry point
└── main.css          # Global styles
```

## Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication and choose your preferred sign-in methods
3. Set up Firestore Database
4. Copy your Firebase config values to your `.env.local` file

## Development

The application uses:

- **Hot Module Replacement** for fast development
- **TypeScript** for type safety
- **ESLint** and **Prettier** for code quality (configure as needed)
- **Tailwind CSS** for utility-first styling

## Building for Production

```bash
npm run build
```

The build output will be in the `dist/` directory, ready for deployment to any static hosting service.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes and commit: `git commit -m 'Add new feature'`
4. Push to the branch: `git push origin feature/new-feature`
5. Submit a pull request

## License

This project is private and proprietary.
