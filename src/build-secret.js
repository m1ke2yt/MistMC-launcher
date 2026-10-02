'use strict';

// Сборочные данные официального лаунчера Mist MC: ключ подписи, client_id входа
// Microsoft и служебные адреса (зеркала, прокси, пути API сайта).
// В публичный репозиторий они не входят — здесь заглушка с пустыми значениями.
// Лаунчер из исходников ставит и запускает игру; с сайтом Mist MC он не
// общается, а для входа Microsoft нужен свой client_id из Azure/Entra ID.
module.exports = {
  HEARTBEAT_HMAC_KEY: '',
  MS_CLIENT_ID: '',
  NET: {
    joinHost: '',
    mirrorSite: '',
    mirrorDownloads: '',
    mojangProxy: '',
    packUrls: [],
    modrinthApi: '',
    modrinthCdn: '',
    api: {
      status: '',
      heartbeat: '',
      vote: '',
      top: '',
      share: '',
      cosmetics: '',
      cape: '',
      skin: '',
      cosmeticPack: '',
    },
  },
};
