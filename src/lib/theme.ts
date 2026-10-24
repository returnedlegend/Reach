export const THEME_STORAGE_KEY = "reach-theme";
// Runs before content paints. Only a non-sensitive appearance preference is read.
export const themeBootstrap = `(function(){try{var t=localStorage.getItem('reach-theme');document.documentElement.dataset.theme=(t==='reach'||t==='reach-dark')?t:(matchMedia('(prefers-color-scheme: dark)').matches?'reach-dark':'reach')}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'reach-dark':'reach'}})()`;
