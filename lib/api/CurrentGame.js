'use strict'

const restPoint = {
  fullName: 'current-game-v1.0',
  name: 'current-game',
  version: '1.0'
}

const genURL = (region, platform, summonerId) => {
  return `https://${region}.api.pvp.net/observer-mode/rest/consumer/getSpectatorGameInfo/${platform}/${summonerId}`
}

function getCurrentGame (region, summonerId) {
  var platform = region.toUpperCase()
  if (platform !== 'KR' && platform !== 'RU') {
    platform = platform + '1'
  }
  if (platform === 'OCE1') {
    platform = 'OC1'
  }
  if (platform === 'EUNE1') {
    platform = 'EUN1'
  }

  var requestParams = {
    rest: restPoint,
    caller: 'getCurrentGame',
    region: region,
    url: genURL(region, platform, summonerId),
    cache: {
      ttl: 10,
      key: `currentGame-${summonerId}`,
      saveIfNull: false
    }
  }

  return this._makeCachedRequest(requestParams)
}

module.exports = {
  restPoint,
  methods: {
    getCurrentGame
  }
}