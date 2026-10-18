import AsyncStorage from "@react-native-async-storage/async-storage";

// Recibos em que o passageiro já respondeu "a viagem terminou antes do
// destino". Fica no aparelho para a pergunta não voltar a cada abertura do app
// (antes só havia a memória da sessão). O backend também registra a resposta
// no booking (earlyEndReviewStatus).
const STORAGE_KEY = "leaf:early-end-answered:v1";
const MAX_ENTRIES = 100;

let cache = null;
let loading = null;

export function loadEarlyEndAnsweredIds() {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const parsed = raw ? JSON.parse(raw) : [];
        cache = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
        return cache;
      })
      .catch(() => {
        cache = new Set();
        return cache;
      });
  }
  return loading;
}

export async function markEarlyEndAnswered(receiptId) {
  const id = String(receiptId || "").trim();
  if (!id) return;
  const answered = await loadEarlyEndAnsweredIds();
  answered.add(id);
  const ids = Array.from(answered).slice(-MAX_ENTRIES);
  cache = new Set(ids);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (_error) {
    // Sem gravação o pior caso é perguntar de novo; nunca bloqueia o recibo.
  }
}

export function isEarlyEndAnsweredStatus(status) {
  return String(status || "").trim().toUpperCase().startsWith("PASSENGER_");
}

export function resetEarlyEndAnswerStoreForTests() {
  cache = null;
  loading = null;
}
