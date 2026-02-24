/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        washedup: {
          orange: '#C4652A',
          cream: '#FFF8F0',
          'text-dark': '#1A1A1A',
          'text-medium': '#666666',
          'text-light': '#999999',
          card: '#FFFFFF',
          border: '#E5E5E5',
          success: '#4CAF50',
          error: '#E53935',
        },
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
};
