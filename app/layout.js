import './globals.css';

export const metadata = {
  title: 'Polymarket Signal Scanner',
  description: 'Scan Polymarket prediction markets for any stock list',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
