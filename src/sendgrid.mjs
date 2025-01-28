import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const sgMail = require('@sendgrid/mail')

import { config } from './config.mjs'

const init = {
  done: false,
  ok: false
}

export async function smSendgrid (to, sub, txt) {
  if (!init.done) {
    const api_key = config.alertes ? config.alertes._sendgrid_api_key : null
    if (api_key) {
      sgMail.setApiKey(api_key)
      init.ok = true
    } else {
      init.ok = false
    }
  } else {
    if (!init.ok) return
  }
  
  const msg = {
    to: to,
    from: config.alertes._from, // Use the email address or domain you verified above
    subject: sub,
    text: txt || '-'
  }

  try {
    await sgMail.send(msg)
  } catch (error) {
    config.logger.error('sendAlMail: [sendgrid] -  ' + error.toString())
    // if (error.response) config.logger.error('sendAlMail: [sendgrid] -  ' + error.response.body)
  }

}
