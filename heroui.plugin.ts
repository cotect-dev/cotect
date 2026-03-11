import { heroui } from '@heroui/theme'

export default heroui({
  defaultTheme: 'dark',
  themes: {
    dark: {
      colors: {
        background: '#0f050f',
        foreground: '#adfeff',
        default: {
          50: '#190f24',
          100: '#221830',
          200: '#312244',
          300: '#3e1f47',
          400: '#4d194d',
          500: '#583e7a',
          600: '#7f5cad',
          700: '#aa92c8',
          800: '#d4c9e4',
          900: '#ebc1eb',
          DEFAULT: '#271b36',
          foreground: '#adfeff',
        },
        primary: {
          50: '#001414',
          100: '#002829',
          200: '#003c3d',
          300: '#005052',
          400: '#006466',
          500: '#00b5b8',
          600: '#0afbff',
          700: '#5cfcff',
          800: '#adfeff',
          900: '#d6feff',
          DEFAULT: '#0afbff',
          foreground: '#0f050f',
        },
        focus: '#0afbff',
        content1: '#140e1b',
        content2: '#1d1529',
        content3: '#271b36',
        content4: '#312244',
        divider: '#464573',
        overlay: '#08080d',
      },
    },
  },
})
