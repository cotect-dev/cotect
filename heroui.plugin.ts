import { heroui } from '@heroui/theme'

export default heroui({
  defaultTheme: 'dark',
  themes: {
    dark: {
      colors: {
        background: '#00111c',
        foreground: '#9ed8ff',
        default: {
          50: '#001a2c',
          100: '#002137',
          200: '#002945',
          300: '#003356',
          400: '#003a61',
          500: '#00406c',
          600: '#0071bc',
          700: '#0d9eff',
          800: '#5ebfff',
          900: '#acdeff',
          DEFAULT: '#002e4e',
          foreground: '#9ed8ff',
        },
        primary: {
          50: '#000a11',
          100: '#001523',
          200: '#002a45',
          300: '#003356',
          400: '#003a61',
          500: '#00406c',
          600: '#0071bc',
          700: '#0d9eff',
          800: '#5ebfff',
          900: '#acdeff',
          DEFAULT: '#0d9eff',
          foreground: '#00111c',
        },
        focus: '#0d9eff',
        content1: '#001a2c',
        content2: '#002137',
        content3: '#002945',
        content4: '#002e4e',
        divider: '#003356',
        overlay: '#000305',
      },
    },
  },
})
