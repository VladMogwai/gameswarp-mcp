import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Gameswarp',
  description: 'What actually happened to a game, according to the people who played it',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
