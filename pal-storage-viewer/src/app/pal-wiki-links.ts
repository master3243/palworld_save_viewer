export interface PalWikiLink {
  label: string;
  site: string;
  domain: string;
  className: string;
  url: string;
}

export function palWikiLinks(name: string, game8Url = 'https://game8.co/games/Palworld/archives/439556'): PalWikiLink[] {
  const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
  return [
    { label: 'GG', site: 'Palworld Wiki', domain: 'palworld.wiki.gg', className: 'wikigg-link', url: `https://palworld.wiki.gg/wiki/${slug}` },
    { label: 'CC', site: 'PalDB', domain: 'paldb.cc', className: 'paldb-link', url: `https://paldb.cc/en/${slug}` },
    { label: 'P', site: 'Palpedia', domain: 'palpedia.net', className: 'palpedia-link', url: `https://www.palpedia.net/pals/${encodeURIComponent(name)}` },
    { label: '8', site: 'Game8', domain: 'game8.co', className: 'game8-link', url: game8Url },
    { label: 'F', site: 'Fandom', domain: 'palworld.fandom.com', className: 'fandom-link', url: `https://palworld.fandom.com/wiki/${slug}` },
  ];
}
