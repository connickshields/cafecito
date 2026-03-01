/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        body: ['Nunito', 'sans-serif'],
      },
      colors: {
        primary: '#FFCF33',
        secondary: '#E2B4BD',
        accent: '#F5BC00',
        background: '#424B54',
        neutral: '#93A8AC',
        parchment: '#FBF7F0',
        espresso: '#2C1810',
      },
    },
  },
  plugins: [],
}