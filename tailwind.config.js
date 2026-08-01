/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/pages/settings.html',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        edge: {
          bg: 'var(--settings-bg)',
          sidebar: 'var(--settings-sidebar-bg)',
          hover: 'var(--settings-hover)',
          selected: 'var(--settings-selected)',
          border: 'var(--settings-border)',
          text: 'var(--settings-text)',
          muted: 'var(--settings-muted)',
          input: 'var(--settings-input-bg)',
          accent: 'var(--settings-accent)',
          danger: 'var(--settings-danger)',
        },
      },
      borderRadius: {
        edge: '6px',
      },
    },
  },
  plugins: [],
};
