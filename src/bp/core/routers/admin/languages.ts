import axios from 'axios'
import { Logger } from 'botpress/sdk'
import { ConfigProvider } from 'core/config/config-loader'
import { ModuleLoader } from 'core/module-loader'
import { WorkspaceService } from 'core/services/workspace-service'
import { RequestHandler, Router } from 'express'
import Joi from 'joi'
import _ from 'lodash'

import { CustomRouter } from '../customRouter'
import { needPermissions } from '../util'
import { GhostService } from 'core/services'

export class LanguagesRouter extends CustomRouter {
  private needPermissions: (operation: string, resource: string) => RequestHandler
  private readonly resource = 'admin.languages'

  constructor(
    private logger: Logger,
    private moduleLoader: ModuleLoader,
    private workspaceService: WorkspaceService,
    private configProvider: ConfigProvider,
    private ghostService: GhostService
  ) {
    super('Languages', logger, Router({ mergeParams: true }))
    this.needPermissions = needPermissions(this.workspaceService)
    this.setupRoutes()
  }

  async getSourceClient() {
    const config = await this.moduleLoader.configReader.getGlobal('nlu')
    const source = config.languageSources[0]

    const headers = {
      timeout: 20000,
      ...(source.authToken && { authorization: 'bearer ' + source.authToken })
    }
    return axios.create({ baseURL: source.endpoint, headers })
  }

  private async getExtraLangs(): Promise<any[]> {
    const { additionalLanguages } = await this.configProvider.getBotpressConfig()
    const { error } = Joi.validate(
      additionalLanguages,
      Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          code: Joi.string().required()
        })
      )
    )

    if (error) {
      this.logger.warn('Additional languages are not valid')
      return []
    }

    return additionalLanguages || []
  }

  setupRoutes() {
    const router = this.router

    router.get(
      '/',
      this.needPermissions('read', this.resource),
      this.asyncMiddleware(async (req, res) => {
        try {
          const client = await this.getSourceClient()
          const { data } = await client.get('/languages')

          res.send({
            ...data,
            ...(await this.getExtraLangs())
          })
        } catch (err) {
          res.status(500).send(err.message)
        }
      })
    )

    router.get(
      '/sources',
      this.needPermissions('read', this.resource),
      this.asyncMiddleware(async (req, res) => {
        const config = await this.moduleLoader.configReader.getGlobal('nlu')
        res.send({
          languageSources: config.languageSources
        })
      })
    )

    router.get(
      '/info',
      this.needPermissions('read', this.resource),
      this.asyncMiddleware(async (req, res) => {
        try {
          const client = await this.getSourceClient()
          await client.get('/info').then(({ data }) => res.send(data))
        } catch (err) {
          res.status(500).send(err.message)
        }
      })
    )

    router.post(
      '/:lang',
      this.needPermissions('write', this.resource),
      this.asyncMiddleware(async (req, res) => {
        try {
          const client = await this.getSourceClient()
          await client.post('/languages/' + req.params.lang).then(({ data }) => res.send(data))
        } catch (err) {
          res.status(500).send(err)
        }
      })
    )

    router.post(
      '/:lang/load',
      this.needPermissions('write', this.resource),
      this.asyncMiddleware(async (req, res) => {
        try {
          const client = await this.getSourceClient()
          await client.post(`/languages/${req.params.lang}/load`).then(({ data }) => res.send(data))
        } catch (err) {
          res.status(500).send(err.message)
        }
      })
    )

    router.post(
      '/:lang/delete',
      this.needPermissions('write', this.resource),
      this.asyncMiddleware(async (req, res) => {
        try {
          const client = await this.getSourceClient()
          await client.post(`/languages/${req.params.lang}/delete`).then(({ data }) => res.send(data))
        } catch (err) {
          res.status(500).send(err.message)
        }
      })
    )

    router.get(
      '/available',
      this.needPermissions('read', this.resource),
      this.asyncMiddleware(async (req, res) => {
        let languagesData
        try {
          const client = await this.getSourceClient()
          languagesData = (await client.get('/languages')).data
        } catch (e) {
          languagesData = { installed: [], available: [] }
          const { languageSources } = await this.ghostService.global().readFileAsObject('/config/', 'nlu.json')
          if (languageSources.length && languageSources[0].endpoint)
            this.logger.warn(`Please remove the languageSources from nlu.json if you don't want to use it`)
        }

        const languages = [
          ...languagesData.installed
            .filter(x => x.loaded)
            .map(x => ({
              ...languagesData.available.find(l => l.code === x.lang)
            })),
          ...(await this.getExtraLangs())
        ]

        res.send({ languages })
      })
    )
  }
}
