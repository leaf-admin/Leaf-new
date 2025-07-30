export const getLangKey = (word) => {
  if (word) {
    let str = word.toLowerCase();
    let langKey = str.trim().split(/\s+/).join("_").replace(/[.$#/[\]]/g, "") + "_";
    return langKey;
  }
  return ""
};