// Mock content lifted from the Claude Design mockups. Friends/Messages/Discover/
// Profile/Account-Settings social data has no backend yet (accounts + social
// features are out of MVP scope per docs/PRODUCT.md) — replace with real API
// calls once that backend exists.

export interface Friend { id: number; name: string; initial: string; color: string; status: string; dotColor: string; hoursWatched: number }
export const friends: Friend[] = [
  { id: 1, name: 'Alex', initial: 'A', color: '#c0392b', status: 'Çevrimiçi', dotColor: '#3ecf6e', hoursWatched: 42 },
  { id: 2, name: 'Mert', initial: 'M', color: '#8b5cf6', status: 'Çevrimiçi', dotColor: '#3ecf6e', hoursWatched: 31 },
  { id: 3, name: 'Deniz', initial: 'D', color: '#2563eb', status: '12 dk önce', dotColor: '#6b6b6b', hoursWatched: 18 },
  { id: 4, name: 'Can', initial: 'C', color: '#0d9488', status: '2 sa önce', dotColor: '#6b6b6b', hoursWatched: 9 },
  { id: 5, name: 'Selin', initial: 'S', color: '#b45309', status: '5 sa önce', dotColor: '#6b6b6b', hoursWatched: 6 },
  { id: 6, name: 'Berk', initial: 'B', color: '#7c3aed', status: 'Çevrimiçi', dotColor: '#3ecf6e', hoursWatched: 4 },
  { id: 7, name: 'Ece', initial: 'E', color: '#dc2626', status: '1 gün önce', dotColor: '#6b6b6b', hoursWatched: 2 },
]

export const pendingMutuals = [
  { name: 'Kaan', initial: 'K', color: '#a16207' },
  { name: 'Ayça', initial: 'A', color: '#15803d' },
]

export const discoverableUsers = [
  { id: 101, name: 'Zeynep', initial: 'Z', color: '#0891b2', code: 'DUOVIE-ZEY41P' },
  { id: 102, name: 'Kaan', initial: 'K', color: '#a16207', code: 'DUOVIE-KAA77M' },
  { id: 103, name: 'Elif', initial: 'E', color: '#be185d', code: 'DUOVIE-ELF03Q' },
  { id: 104, name: 'Barış', initial: 'B', color: '#4338ca', code: 'DUOVIE-BAR58T' },
  { id: 105, name: 'Onur', initial: 'O', color: '#b91c1c', code: 'DUOVIE-ONU12V' },
]

export const activityFeed = [
  { name: 'Alex', initial: 'A', color: '#c0392b', activity: 'Interstellar izliyor', time: 'şimdi', dotColor: '#3ecf6e' },
  { name: 'Mert', initial: 'M', color: '#8b5cf6', activity: 'The Bear izliyor', time: 'şimdi', dotColor: '#3ecf6e' },
  { name: 'Deniz', initial: 'D', color: '#2563eb', activity: 'Yeni oda kurdu', time: '12 dk önce', dotColor: '#3ecf6e' },
  { name: 'Can', initial: 'C', color: '#0d9488', activity: 'Son görülme', time: '2 sa önce', dotColor: '#6b6b6b' },
  { name: 'Selin', initial: 'S', color: '#b45309', activity: 'Son görülme', time: '5 sa önce', dotColor: '#6b6b6b' },
]

export const notificationsSeed = [
  { id: 1, name: 'Alex', initial: 'A', color: '#c0392b', text: 'seni bir odaya davet etti', time: '5 dk önce', unread: true },
  { id: 2, name: 'Mert', initial: 'M', color: '#8b5cf6', text: 'sana arkadaşlık isteği gönderdi', time: '2 sa önce', unread: true },
  { id: 3, name: 'Deniz', initial: 'D', color: '#2563eb', text: 'The Bear izlemeye başladı', time: '1 gün önce', unread: false },
  { id: 4, name: 'Selin', initial: 'S', color: '#b45309', text: 'odanıza katıldı', time: '2 gün önce', unread: false },
]

export const recentSessions = [
  { name: 'Alex', initial: 'A', color: '#c0392b', title: "Interstellar'ı", time: 'Dün' },
  { name: 'Mert', initial: 'M', color: '#8b5cf6', title: "The Bear'ı", time: '3 gün önce' },
  { name: 'Deniz', initial: 'D', color: '#2563eb', title: "Oppenheimer'ı", time: '1 hafta önce' },
]

export interface DiscoverRoom { id: number; name: string; activityLabel: string; category: string; occupied: number; host: string; hostColor: string; hostInitial: string }
export const discoverRooms: DiscoverRoom[] = [
  { id: 1, name: 'Film Gecesi', activityLabel: 'Birlikte İzle', category: 'Romantik', occupied: 1, host: 'Erdem', hostColor: '#c0392b', hostInitial: 'E' },
  { id: 2, name: 'Anime Keyfi', activityLabel: 'Birlikte İzle', category: 'Anime', occupied: 1, host: 'Naz', hostColor: '#be185d', hostInitial: 'N' },
  { id: 3, name: 'Retro Oyun Gecesi', activityLabel: 'Birlikte Oyna', category: 'Oyun', occupied: 2, host: 'Kerem', hostColor: '#a16207', hostInitial: 'K' },
  { id: 4, name: 'Sohbet Odası', activityLabel: 'Sohbet', category: 'Genel', occupied: 1, host: 'Buse', hostColor: '#0891b2', hostInitial: 'B' },
  { id: 5, name: 'Belgesel Kulübü', activityLabel: 'Birlikte İzle', category: 'Belgesel', occupied: 1, host: 'Onur', hostColor: '#166534', hostInitial: 'O' },
  { id: 6, name: 'Korku Gecesi', activityLabel: 'Birlikte İzle', category: 'Korku', occupied: 2, host: 'Zeynep', hostColor: '#5b21b6', hostInitial: 'Z' },
  { id: 7, name: 'Stand-up Keyfi', activityLabel: 'Birlikte İzle', category: 'Komedi', occupied: 1, host: 'Tolga', hostColor: '#b45309', hostInitial: 'T' },
  { id: 8, name: 'Dizi Maratonu', activityLabel: 'Birlikte İzle', category: 'Dizi', occupied: 1, host: 'Aylin', hostColor: '#be123c', hostInitial: 'A' },
]

export const suggestedPeople = [
  { id: 1, name: 'Buse', handle: 'buse', reason: '3 ortak arkadaş', initial: 'B', color: '#0891b2' },
  { id: 2, name: 'Kerem', handle: 'kerem', reason: 'Aynı ilgi alanları', initial: 'K', color: '#78350f' },
  { id: 3, name: 'Naz', handle: 'naz', reason: 'Benzer izleme zevki', initial: 'N', color: '#be185d' },
  { id: 4, name: 'Onur', handle: 'onur', reason: '2 ortak arkadaş', initial: 'O', color: '#b91c1c' },
]

export interface Conversation { id: number; name: string; initial: string; color: string; dotColor: string; online: boolean; lastSeen?: string; streak?: number; lastMessage: string; time: string; unread: boolean; isBot?: boolean }
export const conversations: Conversation[] = [
  { id: 0, name: 'Duovie', initial: 'D', color: '#7a1710', dotColor: '#3ecf6e', online: true, lastMessage: 'Hesabını oluşturdun, hoş geldin!', time: '1 sa', unread: false, isBot: true },
  { id: 1, name: 'Alex', initial: 'A', color: '#c0392b', dotColor: '#3ecf6e', online: true, streak: 12, lastMessage: 'Odaya girdim, bekliyorum', time: '2 dk', unread: true },
  { id: 2, name: 'Mert', initial: 'M', color: '#8b5cf6', dotColor: '#3ecf6e', online: true, streak: 5, lastMessage: 'yazıyor...', time: '1 sa', unread: true },
  { id: 3, name: 'Deniz', initial: 'D', color: '#2563eb', dotColor: '#6b6b6b', online: false, lastSeen: '1 gün önce çevrimiçiydi', lastMessage: 'Süper filmdi, tekrar izleyelim', time: '1 gün', unread: false },
  { id: 4, name: 'Can', initial: 'C', color: '#0d9488', dotColor: '#6b6b6b', online: false, lastSeen: '2 gün önce çevrimiçiydi', lastMessage: 'Yarın akşam uyar mı?', time: '2 gün', unread: false },
  { id: 5, name: 'Selin', initial: 'S', color: '#b45309', dotColor: '#6b6b6b', online: false, lastSeen: '3 gün önce çevrimiçiydi', lastMessage: 'Teşekkürler :)', time: '3 gün', unread: false },
]

export interface ChatMsg { from: 'me' | 'them'; text?: string; type?: 'invite'; read?: boolean }
export const conversationMessages: Record<number, ChatMsg[]> = {
  0: [
    { from: 'them', text: "Duovie'ye hoş geldin! Hesabını başarıyla oluşturdun." },
    { from: 'them', text: 'Bir arkadaşını davet et, oda kur ve birlikte izlemeye başla.' },
  ],
  1: [
    { from: 'them', text: 'Selam, bu akşam film var mı?' },
    { from: 'me', text: 'Var tabii, saat 9 uyar mı?', read: true },
    { from: 'them', text: 'Uyar, hangi filmi izleyelim?' },
    { from: 'me', text: 'Interstellar diyorum', read: true },
    { from: 'them', text: 'Odaya girdim, bekliyorum' },
  ],
  2: [
    { from: 'them', text: "The Bear'ın yeni sezonu çıktı" },
    { from: 'me', text: 'Ciddi mi, hemen başlıyoruz', read: false },
  ],
  3: [
    { from: 'me', text: 'Dün akşamki film çok iyiydi' },
    { from: 'them', text: 'Süper filmdi, tekrar izleyelim' },
  ],
  4: [{ from: 'them', text: 'Yarın akşam uyar mı?' }],
  5: [
    { from: 'me', text: 'Rica ederim, iyi seyirler' },
    { from: 'them', text: 'Teşekkürler :)' },
  ],
}

export const topFriends = [
  { id: 1, name: 'Alex', initial: 'A', color: '#c0392b' },
  { id: 2, name: 'Mert', initial: 'M', color: '#8b5cf6' },
  { id: 3, name: 'Deniz', initial: 'D', color: '#2563eb' },
  { id: 4, name: 'Can', initial: 'C', color: '#0d9488' },
  { id: 5, name: 'Selin', initial: 'S', color: '#b45309' },
  { id: 6, name: 'Berk', initial: 'B', color: '#7c3aed' },
  { id: 7, name: 'Ece', initial: 'E', color: '#dc2626' },
]
