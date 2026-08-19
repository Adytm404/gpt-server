export type Server = {
  id: string
  name: string
  host: string
  environment: 'Production' | 'Staging' | 'Development'
  status: 'Healthy' | 'Warning' | 'Offline'
  cpu: number
  memory: number
  disk: number
  region: string
  uptime: string
}

export const servers: Server[] = [
  { id: 'production-api', name: 'Production API', host: 'api.opsai.cloud', environment: 'Production', status: 'Healthy', cpu: 34, memory: 62, disk: 48, region: 'sgp-1', uptime: '48d 12h' },
  { id: 'worker-primary', name: 'Worker Primary', host: '10.12.4.21', environment: 'Production', status: 'Warning', cpu: 82, memory: 74, disk: 67, region: 'sgp-1', uptime: '12d 4h' },
  { id: 'staging-web', name: 'Staging Web', host: 'staging.opsai.cloud', environment: 'Staging', status: 'Healthy', cpu: 12, memory: 38, disk: 31, region: 'fra-1', uptime: '7d 19h' },
  { id: 'dev-sandbox', name: 'Dev Sandbox', host: '192.168.40.8', environment: 'Development', status: 'Offline', cpu: 0, memory: 0, disk: 22, region: 'local', uptime: '-' },
]

export const executionLogs = [
  { type: 'system', text: 'Connected to api.opsai.cloud', time: '14:32:08.104', delay: 360 },
  { type: 'command', text: 'deploy@production-api:~$ uptime', time: '14:32:08.466', delay: 180 },
  { type: 'stdout', text: ' 14:32:08 up 48 days, 12:17,  2 users,  load average: 0.84, 0.92, 0.76', time: '14:32:08.651', delay: 520 },
  { type: 'command', text: 'deploy@production-api:~$ free -m', time: '14:32:09.174', delay: 160 },
  { type: 'stdout', text: '               total        used        free      shared  buff/cache   available', time: '14:32:09.338', delay: 55 },
  { type: 'stdout', text: 'Mem:           15984        9912        1748         224        4324        5581', time: '14:32:09.394', delay: 55 },
  { type: 'stdout', text: 'Swap:           2047           0        2047', time: '14:32:09.450', delay: 640 },
  { type: 'command', text: 'deploy@production-api:~$ ps -eo user,pid,pcpu,pmem,etime,cmd --sort=-pcpu | head -n 6', time: '14:32:10.091', delay: 190 },
  { type: 'stdout', text: 'USER         PID %CPU %MEM     ELAPSED CMD', time: '14:32:10.285', delay: 45 },
  { type: 'stdout', text: 'node        2201 31.2 18.4    02:18:44 node dist/worker.js', time: '14:32:10.331', delay: 45 },
  { type: 'stdout', text: 'postgres    1842 12.8  8.1  12-04:11:20 postgres: checkpointer', time: '14:32:10.377', delay: 45 },
  { type: 'stdout', text: 'node        2198  4.7  6.3    02:18:45 node dist/api.js', time: '14:32:10.423', delay: 45 },
  { type: 'stdout', text: 'redis      1054  1.3  0.8  48-12:16:52 /usr/bin/redis-server 127.0.0.1:6379', time: '14:32:10.469', delay: 620 },
  { type: 'command', text: 'deploy@production-api:~$ systemctl --failed --no-legend --no-pager', time: '14:32:11.090', delay: 280 },
  { type: 'stdout', text: '', time: '14:32:11.372', delay: 110 },
  { type: 'command', text: 'deploy@production-api:~$ systemctl is-active nginx api.service postgresql redis-server', time: '14:32:11.483', delay: 150 },
  { type: 'stdout', text: 'active', time: '14:32:11.637', delay: 35 },
  { type: 'stdout', text: 'active', time: '14:32:11.673', delay: 35 },
  { type: 'stdout', text: 'active', time: '14:32:11.709', delay: 35 },
  { type: 'stdout', text: 'active', time: '14:32:11.745', delay: 180 },
  { type: 'command', text: 'deploy@production-api:~$ ', time: '14:32:11.926', delay: 100 },
]
