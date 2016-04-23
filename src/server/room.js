import EventEmitter from 'events'
import Player from './player'
import Bot from '../common/bot'
import Board from '../common/board'

export default class Room extends EventEmitter {

  static STOPPED = 0;
  static STARTING = 1;
  static STARTED = 2;

  players = {};

  constructor (cursor, options, rules) {
    super()
    this.cursor = cursor
    this.namespace = this.cursor.path.join('-')
    this.cursor.set({
      ...options,
      rules: {
        height: 24,
        width: 12,
        specials: true,
        generator: 1,
        entrydelay: 0,
        rotationsystem: 1,
        tspin: true,
        holdpiece: true,
        nextpiece: 3,
        ...rules
      },
      players: {},
      state: Room.STOPPED,
      winners: []
    })
    this.cursor.on('update', (x) => {
      const {
        state,
        players
      } = x.data.currentData
      if (state === Room.STOPPED) {
        const allReady = Object.values(players)
          .every(({state}) => state === Player.READY)
        const numHumans = Object.keys(players)
          .map(id => this.players[id])
          .filter(p => !p.bot)
          .length
        if (allReady && numHumans >= 1) {
          const indices = Object.keys(players)
          shuffle(indices)
          this.cursor.deepMerge({
            state: Room.STARTED,
            players: Object.keys(players).reduce((acc, id) => ({
              ...acc,
              [id]: {
                index: indices.indexOf(id) + 1,
                state: Player.PLAYING
              }
            }), {})
          })
          console.log('Starting game')
        }
      } else {
        const active = Object.keys(players)
          .map(id => ({ id, ...players[id] }))
          .filter(({state}) => state === Player.PLAYING)
        if (active.length === 1 && Object.values(players).length >= 1) {
          console.log('game ended', state, players)
          const winner = active[0]
          this.cursor.deepMerge({
            state: Room.STOPPED,
            winners: [winner.id],
            players: {
              [winner.id]: { state: Player.IDLE }
            }
          })
        }
      }
    })
  }

  join (socket, options) {
    const id = socket.client.id
    const cursor = this.cursor.select(['players', id])
    this.players[id] = new Player(socket, cursor, options, this)
    socket.join(this.namespace)
    socket.on('disconnect', (x) => {
      cursor.unset()
      delete this.players[id]
    })
    socket.on('special', (data) => {
      console.log('use special', data)
      const target = this.players[data.id]
      if (target && target.socket) {
        target.socket.emit('special', data)
      } else if (target && target.bot) {
        target.bot.use(data)
      }
    })
    socket.on('lines', (lines) => {
      console.log('lines', lines)
      socket.broadcast.to(this.namespace).emit('lines', lines)
      Object.values(this.players)
        .map(({ bot }) => bot)
        .filter(x => x)
        .forEach(bot => bot.addLines(lines))
    })
    return this.players[id]
  }

  addBot (options) {
    const id = `Bot ${Math.floor(Math.random() * 1000000)}`
    const cursor = this.cursor.select(['players', id])
    const state = cursor.select('state')
    const player = new Player(null, cursor, {name: id}, this)
    const bot = new Bot(null, options)
    player.bot = bot
    this.players[id] = player

    state.set(Player.READY)
    state.on('update', ({data: { previousData, currentData }}) => {
      if (currentData === Player.IDLE) {
        console.log('bot ready2')
        bot.stop()
        state.set(Player.READY)
      } else if (currentData === Player.PLAYING) {
        console.log('bot starting')
        bot.start(0, this.cursor.get('rules'))
      }
    })
    bot.on(Board.EVENT_CHANGE, () => cursor.set('data', bot.data))
    bot.on(Player.EVENT_GAMEOVER, () => {
      console.log('Bot died')
      state.set(Player.IDLE)
    })
    return player
  }
}

function shuffle (a) {
  for (let i = a.length; i; i -= 1) {
    const j = Math.floor(Math.random() * i)
    const tmp = a[i - 1]
    a[i - 1] = a[j]
    a[j] = tmp
  }
}
