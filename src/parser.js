import puppeteer from 'puppeteer'
import crypto from 'crypto'
import path from 'path'
import { logger } from './logger.js'

function cleanURL(url) {
    return url.replace(/\?(.+)/, '')
}

function generateFilename(url) {
    const extension = path.extname(cleanURL(url))
    const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8)
    return `${Date.now()}-${hash}${extension}`
}

export class Parser {
    constructor() {
        this.browser = null
    }

    async start() {
        if (this.browser) return
        logger.log('debug', `[${this.constructor.name}] Starting browser...`)
        this.browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=430x932'
            ]
        })
        logger.log('debug', `[${this.constructor.name}] Browser started`)
    }

    async close() {
        if (this.browser) {
            await this.browser.close()
            this.browser = null
            logger.log('debug', `[${this.constructor.name}] Browser closed`)
        }
    }

    async parse(url) {
        logger.log('debug', `[${this.constructor.name}] Parsing ${url}...`)
        const page = await this.browser.newPage()
        const customUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/564431005;FBDV/iPhone17,1;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/en_GB;FBOP/5;FBRV/567052743]'
        await page.setUserAgent(customUA)
        try {

            // Navigate to page
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            })

            // Wait for network to be idle
            await page.waitForNetworkIdle({
                timeout: 5000,
                idleTime: 100
            })

            await page.waitForSelector('[data-interactive-id]')

            const media = []

            /*global document*/
            const evaluatedResult = await page.evaluate(() => {
                try {

                    function getDescriptionText(div) {
                        const h1 = div.querySelector('h1')
                        if (!h1) return null
                        h1.childNodes.forEach(child => {
                            if (child.nodeType != 3) {
                                h1.removeChild(child)
                            }
                        })
                        return h1.innerText
                    }

                    function getImages(div) {
                        const images = div.querySelectorAll("img[height='100%'],picture > img")
                        return Array.from(images).map(image => {
                            const video = image.nextElementSibling?.querySelector("video")
                            return {
                                src: image.src,
                                alt: image.alt,
                                type: video ? 'thumbnail' : 'photo'
                            }
                        })
                    }

                    function getVideos(div) {
                        const videos = div.querySelectorAll("video")
                        return Array.from(videos).map(video => ({
                            src: video.src,
                            type: 'video'
                        }))
                    }

                    function getCreatedAt(div) {
                        const time = div.querySelector("time")
                        return time ? time.dateTime : null
                    }

                    function getProfileImageURL(div) {
                        const image = div.querySelector("img[alt$='profile picture']")
                        return image ? image.src : null
                    }

                    function getAuthorName(document) {
                        const head = document.querySelector("head")
                        if (head) {
                            const content = head.querySelector("meta[property='og:title']")?.content
                            if (content) {
                                const splits = content.split(" ")
                                return splits.length > 0 ? splits[0] : null
                            }
                            return null
                        }
                    }

                    function getStatus(div) {
                        const likeElement = div.querySelector('svg[aria-label="Like"]')
                        const likeCount = parseInt(likeElement?.nextElementSibling?.innerText) || 0

                        const replyElement = div.querySelector('svg[aria-label="Reply"]')
                        const replyCount = parseInt(replyElement?.nextElementSibling?.innerText) || 0

                        const repostElement = div.querySelector('svg[aria-label="Repost"]')
                        const repostCount = parseInt(repostElement?.nextElementSibling?.innerText) || 0

                        const shareElement = div.querySelector('svg[aria-label="Share"]')
                        const shareCount = parseInt(shareElement?.nextElementSibling?.innerText) || 0

                        return { likeCount, replyCount, repostCount, shareCount }
                    }

                    const divs = document.querySelectorAll('[data-interactive-id]')
                    if (divs.length > 0) {
                        const div = divs[0]
                        const images = getImages(div)
                        const videos = getVideos(div)
                        const description = getDescriptionText(div)

                        const authorName = getAuthorName(document)
                        const profileImageURL = getProfileImageURL(div)
                        const createdAt = getCreatedAt(div)
                        const status = getStatus(div)

                        return {
                            description,
                            images,
                            videos,
                            authorName,
                            profileImageURL,
                            createdAt,
                            status
                        }
                    }
                } catch (ex) {
                    logger.log('error', ex)
                    return {
                        description: null,
                        images: null,
                        videos: null,
                        authorName: null,
                        profileImageURL: null,
                        createdAt: null,
                        status: null
                    }
                }
            })

            if (!evaluatedResult) throw new Error('failed to evaluate page')

            const { description, images, videos, authorName, profileImageURL, createdAt, status } = evaluatedResult

            images.forEach(image => {
                media.push({
                    alt: image.alt,
                    filename: generateFilename(image.src),
                    url: image.src,
                    type: image.type
                })
            })

            videos.forEach(video => {
                media.push({
                    filename: generateFilename(video.src),
                    url: video.src,
                    type: 'video'
                })
            })

            const result = {
                requestUrl: url,
                description,
                authorName,
                profileImageURL,
                createdAt,
                status,
                media
            }
            return result

        } catch (ex) {
            logger.log('error', ex)
        } finally {
            await page.close()
            logger.log('debug', `[${this.constructor.name}] Page closed`)
        }
    }
}

if (process.env.url) {
    const parser = new Parser()
    await parser.start()
    const result = await parser.parse(process.env.url)
    logger.log('info', result)
    await parser.close()
}