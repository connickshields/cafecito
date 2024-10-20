/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        body: ['Lato', 'sans-serif'],
      },
      colors: {
        primary: '#FFCF33',
        secondary: '#E2B4BD',
        accent: '#EF8354',
        background: '#424B54',
        neutral: '#93A8AC',
      },
    },
  },
  plugins: [],
}