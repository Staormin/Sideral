import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import '@fontsource-variable/manrope'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import 'vuetify/styles'
import './styles/main.css'
import App from './App.vue'

const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'stellar',
    themes: {
      stellar: {
        dark: true,
        colors: {
          background: '#080d16',
          surface: '#101720',
          primary: '#deb478',
          secondary: '#9eafc1',
          info: '#98bed6',
          success: '#85b49a',
          warning: '#deb478',
          error: '#e38d8d',
          'on-background': '#e9eaf0',
          'on-surface': '#e9eaf0',
          'on-primary': '#17120c',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'text', rounded: 'lg', elevation: 0 },
    VCard: { rounded: 'xl', elevation: 0 },
    VDialog: { scrollable: true },
  },
})

createApp(App).use(vuetify).mount('#app')
