import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ArticleAdditionType,
  TechnicalArticleAdditionState,
} from '@prisma/client';
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import { DocxUtil } from '../../common/utils/docx.util';
import { ConstantsService } from '../../config/constants.service';
import { LocalesService } from '../../config/locales.service';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { ArticlesService } from '../articles/articles.service';
import { BothubService } from '../bothub/bothub.service';
import { GenerationSettingsService } from '../generation-settings/generation-settings.service';
import { RedisService } from '../redis/redis.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { SessionsService } from '../sessions/sessions.service';
import { TechnicalArticleAdditionsService } from '../technical-article-additions/technical-article-additions.service';
import { TextRuService } from '../text-ru/text-ru.service';
import { BitrixService } from '../bitrix/bitrix.service';
import { UsersService } from '../users/users.service';

type UserContext = {
  title?: string;
  articleId?: string;
  questions?: string;
  articleContent?: string;
  factCheckContent?: string;
  rewrittenArticleContent?: string;
  settingType?: string;
  settingParam?: string;
  bitrixId?: string;
};

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private bot: Bot<Context>;
  private botToken: string | null = null;
  private uniquenessInterval: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly scenariosService: ScenariosService,
    private readonly localesService: LocalesService,
    private readonly constantsService: ConstantsService,
    private readonly bothubService: BothubService,
    private readonly generationSettingsService: GenerationSettingsService,
    private readonly articlesService: ArticlesService,
    private readonly redisService: RedisService,
    private readonly appLogger: AppLoggerService,
    private readonly technicalArticleAdditionsService: TechnicalArticleAdditionsService,
    private readonly textRuService: TextRuService,
    private readonly bitrixService: BitrixService,
  ) {}

  async onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }

    this.botToken = token;
    this.bot = new Bot<Context>(token);
    const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
    const startCommand =
      this.constantsService.get<string>('commands.start') ?? 'start';
    const cancelCommand =
      this.constantsService.get<string>('commands.cancel') ?? 'cancel';
    const menuCommand =
      this.constantsService.get<string>('commands.menu') ?? 'menu';

    this.bot.use(async (ctx, next) => {
      // Deduplication to prevent multiple processing of the same update (e.g. on webhook retries)
      const updateId = ctx.update.update_id.toString();
      const lockKey = `update_lock:${updateId}`;
      const isLocked = await this.redisService.get(lockKey);
      if (isLocked) {
        this.logger.log(`Update ${updateId} is already being processed, skipping`);
        return;
      }
      await this.redisService.set(lockKey, '1', 60);

      const userContext = this.getUserLogContext(ctx);
      if (ctx.callbackQuery?.data) {
        await this.appLogger.log({
          type: 'user_action',
          action: 'callback',
          callbackData: ctx.callbackQuery.data,
          ...userContext,
        });
      }
      if (ctx.message?.text) {
        await this.appLogger.log({
          type: 'user_action',
          action: 'message',
          text: ctx.message.text,
          ...userContext,
        });
      } else if (ctx.message) {
        await this.appLogger.log({
          type: 'user_action',
          action: 'message',
          messageType: 'non_text',
          ...userContext,
        });
      }
      const telegramId = ctx.from?.id?.toString();
      if (telegramId) {
        const user = await this.usersService.findByTelegramId(telegramId);
        if (user) {
          const state = await this.getUserState(user.id);
          await this.appLogger.log({
            type: 'user_state',
            state,
            ...userContext,
          });
        }
      }
      this.wrapBotMethods(ctx, userContext);
      try {
        await next();
      } catch (error) {
        await this.appLogger.log({
          type: 'bot_error',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          ...userContext,
        });
        throw error;
      }
    });

    // Commands
    this.bot.command(startCommand, async (ctx) => {
      await this.handleStart(ctx);
    });
    this.bot.command(cancelCommand, async (ctx) => {
      await this.handleCancel(ctx);
    });
    this.bot.command(menuCommand, async (ctx) => {
      await this.handleWorkWithArticle(ctx);
    });

    // Callbacks
    const selectScenarioCallback =
      this.constantsService.get<string>('callbacks.select_scenario') ??
      'select_scenario';
    const chooseAnotherScenarioCallback =
      this.constantsService.get<string>('callbacks.choose_another_scenario') ??
      'choose_another_scenario';
    const scenarioPrefix =
      this.constantsService.get<string>('callbacks.scenario_prefix') ??
      'scenario:';

    const workWithArticleCallback =
      this.constantsService.get<string>('callbacks.work_with_article') ??
      'work_with_article';
    const createArticleCallback =
      this.constantsService.get<string>('callbacks.create_article') ??
      'create_article';
    const checkBalanceCallback =
      this.constantsService.get<string>('callbacks.check_balance') ??
      'check_balance';
    const mainMenuCallback =
      this.constantsService.get<string>('callbacks.main_menu') ?? 'main_menu';
    const confirmQuestionsCallback =
      this.constantsService.get<string>('callbacks.confirm_questions') ??
      'confirm_questions';
    const editQuestionsCallback =
      this.constantsService.get<string>('callbacks.edit_questions') ??
      'edit_questions';
    const confirmTitleCallback =
      this.constantsService.get<string>('callbacks.confirm_title') ??
      'confirm_title';
    const reenterTitleCallback =
      this.constantsService.get<string>('callbacks.reenter_title') ??
      'reenter_title';
    const confirmArticleCallback =
      this.constantsService.get<string>('callbacks.confirm_article') ??
      'confirm_article';
    const restartProcessCallback =
      this.constantsService.get<string>('callbacks.restart_process') ??
      'restart_process';
    const factCheckGenerationCallback =
      this.constantsService.get<string>('callbacks.fact_check_generation') ??
      'fact_check_generation';
    const editFactCheckCallback =
      this.constantsService.get<string>('callbacks.edit_fact_check') ??
      'edit_fact_check';
    const factCheckRewriteCallback =
      this.constantsService.get<string>('callbacks.fact_check_rewrite') ??
      'fact_check_rewrite';
    const returnToArticleMenuCallback =
      this.constantsService.get<string>('callbacks.return_to_article_menu') ??
      'return_to_article_menu';
    const confirmFactCheckCallback =
      this.constantsService.get<string>('callbacks.confirm_fact_check') ??
      'confirm_fact_check';
    const confirmRewriteCallback =
      this.constantsService.get<string>('callbacks.confirm_rewrite') ??
      'confirm_rewrite';
    const regenerateGenerationCallback =
      this.constantsService.get<string>('callbacks.regenerate_generation') ??
      'regenerate_generation';
    const productsCallback =
      this.constantsService.get<string>('callbacks.products') ?? 'products';
    const rubricsCallback =
      this.constantsService.get<string>('callbacks.rubrics') ?? 'rubrics';
    const seoOptimizationCallback =
      this.constantsService.get<string>('callbacks.seo_optimization') ??
      'seo_optimization';
    const createBitrixTaskCallback =
      this.constantsService.get<string>('callbacks.create_bitrix_task') ??
      'create_bitrix_task';
    const attachBitrixIdCallback =
      this.constantsService.get<string>('callbacks.attach_bitrix_id') ??
      'attach_bitrix_id';
    const checkUniquenessCallback =
      this.constantsService.get<string>('callbacks.check_uniqueness') ??
      'check_uniqueness';
    const downloadFilesCallback =
      this.constantsService.get<string>('callbacks.download_files') ??
      'download_files';
    const downloadPrefix =
      this.constantsService.get<string>('callbacks.download_prefix') ??
      'download:';
    const adminMenuCallback =
      this.constantsService.get<string>('callbacks.admin_menu') ?? 'admin_menu';
    const adminUsersCallback =
      this.constantsService.get<string>('callbacks.admin_users') ??
      'admin_users';
    const adminSettingsCallback =
      this.constantsService.get<string>('callbacks.admin_settings') ??
      'admin_settings';
    const adminBackToMainCallback =
      this.constantsService.get<string>('callbacks.admin_back_to_main') ??
      'admin_back_to_main';
    const adminBackToAdminCallback =
      this.constantsService.get<string>('callbacks.admin_back_to_admin') ??
      'admin_back_to_admin';
    const adminSettingsViewCallback =
      this.constantsService.get<string>('callbacks.admin_settings_view') ??
      'admin_settings_view';
    const adminSettingsEditCallback =
      this.constantsService.get<string>('callbacks.admin_settings_edit') ??
      'admin_settings_edit';

    this.bot.callbackQuery(
      [selectScenarioCallback, chooseAnotherScenarioCallback, mainMenuCallback],
      async (ctx) => {
        if (ctx.callbackQuery.data === mainMenuCallback) {
          await this.handleStart(ctx);
          await ctx.answerCallbackQuery();
        } else {
          await this.handleSelectScenario(ctx);
        }
      },
    );

    this.bot.callbackQuery(checkBalanceCallback, async (ctx) => {
      try {
        const balance = await this.bothubService.getBalance(
          this.getUserLogContext(ctx),
        );
        await ctx.reply(
          `Ваш тариф: ${balance.planType}\nТекущий баланс: ${balance.availableBalance} Caps`,
        );
      } catch (error) {
        this.logger.error(`Error checking balance: ${error}`);
        await ctx.reply('Ошибка получения баланса. Попробуйте позже.');
      }
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery(workWithArticleCallback, async (ctx) => {
      await this.handleWorkWithArticle(ctx);
    });

    this.bot.callbackQuery(createArticleCallback, async (ctx) => {
      this.logger.log(`Received callback: ${createArticleCallback}`);
      await this.handleCreateArticle(ctx);
    });

    this.bot.callbackQuery(confirmTitleCallback, async (ctx) => {
      await this.handleConfirmTitle(ctx);
    });

    this.bot.callbackQuery(reenterTitleCallback, async (ctx) => {
      await this.handleCreateArticle(ctx);
    });

    this.bot.callbackQuery(confirmQuestionsCallback, async (ctx) => {
      await this.handleConfirmQuestions(ctx);
    });

    this.bot.callbackQuery(editQuestionsCallback, async (ctx) => {
      await this.handleEditQuestions(ctx);
    });

    this.bot.callbackQuery(confirmArticleCallback, async (ctx) => {
      await this.handleConfirmArticle(ctx);
    });

    this.bot.callbackQuery(restartProcessCallback, async (ctx) => {
      await this.handleCreateArticle(ctx);
    });

    this.bot.callbackQuery(factCheckGenerationCallback, async (ctx) => {
      await this.handleFactCheckGeneration(ctx);
    });

    this.bot.callbackQuery(editFactCheckCallback, async (ctx) => {
      await this.handleEditFactCheck(ctx);
    });

    this.bot.callbackQuery(factCheckRewriteCallback, async (ctx) => {
      await this.handleFactCheckRewrite(ctx);
    });

    this.bot.callbackQuery(returnToArticleMenuCallback, async (ctx) => {
      await this.handleWorkWithArticle(ctx);
    });

    this.bot.callbackQuery(confirmFactCheckCallback, async (ctx) => {
      await this.handleConfirmFactCheck(ctx);
    });

    this.bot.callbackQuery(confirmRewriteCallback, async (ctx) => {
      await this.handleConfirmRewrite(ctx);
    });

    this.bot.callbackQuery(regenerateGenerationCallback, async (ctx) => {
      await this.handleRegenerate(ctx);
    });

    this.bot.callbackQuery(productsCallback, async (ctx) => {
      await this.handleProducts(ctx);
    });

    this.bot.callbackQuery(rubricsCallback, async (ctx) => {
      await this.handleRubrics(ctx);
    });

    this.bot.callbackQuery(seoOptimizationCallback, async (ctx) => {
      await this.handleSeoOptimization(ctx);
    });

    this.bot.callbackQuery(createBitrixTaskCallback, async (ctx) => {
      await this.handleCreateBitrixTask(ctx);
    });

    this.bot.callbackQuery(attachBitrixIdCallback, async (ctx) => {
      await this.handleAttachBitrixId(ctx);
    });

    this.bot.callbackQuery(checkUniquenessCallback, async (ctx) => {
      await this.handleCheckUniqueness(ctx);
    });

    this.bot.callbackQuery(downloadFilesCallback, async (ctx) => {
      await this.handleDownloadMenu(ctx);
    });

    this.bot.callbackQuery(new RegExp(`^${downloadPrefix}`), async (ctx) => {
      await this.handleDownloadItem(ctx);
    });

    this.bot.callbackQuery(adminMenuCallback, async (ctx) => {
      await this.handleAdminMenu(ctx);
    });

    this.bot.callbackQuery(adminUsersCallback, async (ctx) => {
      await this.handleAdminUsers(ctx);
    });

    this.bot.callbackQuery(adminSettingsCallback, async (ctx) => {
      await this.handleAdminSettings(ctx);
    });

    this.bot.callbackQuery(adminBackToMainCallback, async (ctx) => {
      await this.handleStart(ctx);
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery(adminBackToAdminCallback, async (ctx) => {
      await this.handleAdminMenu(ctx);
    });

    this.bot.callbackQuery(adminSettingsViewCallback, async (ctx) => {
      await this.handleAdminSettingsView(ctx);
    });

    this.bot.callbackQuery(adminSettingsEditCallback, async (ctx) => {
      await this.handleAdminSettingsEdit(ctx);
    });

    // Dynamic callbacks for settings
    this.bot.callbackQuery(/^admin_settings_view:/, async (ctx) => {
      await this.handleAdminSettingsViewType(ctx);
    });

    this.bot.callbackQuery(/^admin_settings_edit:/, async (ctx) => {
      await this.handleAdminSettingsEditType(ctx);
    });

    this.bot.callbackQuery(/^admin_settings_param:/, async (ctx) => {
      await this.handleAdminSettingsEditParam(ctx);
    });

    this.bot.callbackQuery(new RegExp(`^${scenarioPrefix}`), async (ctx) => {
      await this.handleScenarioSelected(ctx);
    });

    this.bot.on('message:text', async (ctx) => {
      await this.handleMessage(ctx);
    });

    this.bot.on('message:document', async (ctx) => {
      await this.handleDocument(ctx);
    });

    try {
      await this.bot.api.setMyCommands([
        {
          command: startCommand,
          description: this.localesService.t('commands.start'),
        },
        {
          command: cancelCommand,
          description: this.localesService.t('commands.cancel'),
        },
        {
          command: menuCommand,
          description: this.localesService.t('commands.menu'),
        },
      ]);
    } catch (error) {
      this.logger.warn(`Failed to set bot commands: ${error}`);
    }

    if (webhookUrl) {
      await this.bot.api.setWebhook(webhookUrl);
      this.logger.log('Telegram webhook set');
    } else {
      void this.bot.start({
        onStart: (botInfo) => {
          this.logger.log(`Telegram bot started as ${botInfo.username}`);
        },
      });
    }

    this.uniquenessInterval = setInterval(() => {
      void this.processUniquenessChecks();
    }, 45000);

    this.bot.catch(async (error) => {
      await this.appLogger.log({
        type: 'bot_error',
        error:
          error.error instanceof Error
            ? error.error.message
            : String(error.error),
        stack: error.error instanceof Error ? error.error.stack : undefined,
        update: error.ctx?.update,
      });
    });
  }

  async onModuleDestroy() {
    if (this.uniquenessInterval) {
      clearInterval(this.uniquenessInterval);
      this.uniquenessInterval = null;
    }
    if (this.bot) {
      await this.bot.stop();
    }
  }

  getBot(): Bot<Context> {
    if (!this.bot) {
      throw new Error('Bot is not initialized');
    }
    return this.bot;
  }

  // Redis helpers
  private async getUserState(userId: string): Promise<string | null> {
    return this.redisService.get(`state:${userId}`);
  }

  private async setUserState(userId: string, state: string): Promise<void> {
    await this.redisService.set(`state:${userId}`, state, 10800);
  }

  private async deleteUserState(userId: string): Promise<void> {
    await this.redisService.del(`state:${userId}`);
  }

  private async getUserContext(userId: string): Promise<UserContext | null> {
    return this.redisService.getJson<UserContext>(`context:${userId}`);
  }

  private async setUserContext(
    userId: string,
    context: UserContext,
  ): Promise<void> {
    await this.redisService.setJson(`context:${userId}`, context, 10800);
  }

  private async deleteUserContext(userId: string): Promise<void> {
    await this.redisService.del(`context:${userId}`);
  }

  private getUserLogContext(ctx: Context) {
    return {
      telegramId: ctx.from?.id,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      chatId: ctx.chat?.id,
    };
  }

  private getUserProfile(ctx: Context) {
    return {
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
    };
  }

  private async logGenerationError(
    ctx: Context,
    stage: string,
    error: unknown,
  ) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    await this.appLogger.log({
      type: 'generation_error',
      stage,
      error: errorMessage,
      stack: errorStack,
      ...this.getUserLogContext(ctx),
    });
  }

  private wrapBotMethods(ctx: Context, userContext: Record<string, unknown>) {
    const reply = ctx.reply.bind(ctx) as unknown as Context['reply'];
    ctx.reply = (async (...args: Parameters<Context['reply']>) => {
      const [text] = args;
      await this.appLogger.log({
        type: 'bot_reply',
        method: 'reply',
        text,
        ...userContext,
      });
      return reply(...args);
    }) as Context['reply'];
    const replyWithDocument = ctx.replyWithDocument.bind(
      ctx,
    ) as unknown as Context['replyWithDocument'];
    ctx.replyWithDocument = (async (
      ...args: Parameters<Context['replyWithDocument']>
    ) => {
      const [document] = args;
      const fileName =
        document instanceof InputFile ? document.filename : undefined;
      await this.appLogger.log({
        type: 'bot_reply',
        method: 'replyWithDocument',
        fileName,
        ...userContext,
      });
      return replyWithDocument(...args);
    }) as Context['replyWithDocument'];
    const answerCallbackQuery = ctx.answerCallbackQuery.bind(
      ctx,
    ) as unknown as Context['answerCallbackQuery'];
    ctx.answerCallbackQuery = (async (
      ...args: Parameters<Context['answerCallbackQuery']>
    ) => {
      const [data] = args;
      await this.appLogger.log({
        type: 'bot_reply',
        method: 'answerCallbackQuery',
        data,
        ...userContext,
      });
      return answerCallbackQuery(...args);
    }) as Context['answerCallbackQuery'];
    if (ctx.editMessageText) {
      const editMessageText = ctx.editMessageText.bind(
        ctx,
      ) as unknown as Context['editMessageText'];
      ctx.editMessageText = (async (
        ...args: Parameters<Context['editMessageText']>
      ) => {
        const [text] = args;
        await this.appLogger.log({
          type: 'bot_reply',
          method: 'editMessageText',
          text,
          ...userContext,
        });
        return editMessageText(...args);
      }) as Context['editMessageText'];
    }
  }

  private async handleStart(ctx: Context, messageText?: string) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      return;
    }

    const profile = this.getUserProfile(ctx);
    let user = await this.usersService.findByTelegramId(telegramId);

    // Scenario 1: User not registered (first time)
    if (!user) {
      user = await this.usersService.createInactive(telegramId, profile);
      await ctx.reply(this.localesService.t('account_pending'));
      return;
    }

    await this.usersService.updateProfile(telegramId, profile);

    // Scenario 2: User registered but not active
    if (!user.isActive) {
      await ctx.reply(this.localesService.t('account_not_active'));
      return;
    }

    // Scenario 3: User registered and active (Session logic)
    let session = await this.sessionsService.findActive(user.id);
    if (!session) {
      session = await this.sessionsService.create(user.id);
    }

    const keyboard = new InlineKeyboard();

    if (user.role === 'admin') {
      keyboard
        .text(
          this.localesService.t('menu.admin'),
          this.constantsService.get<string>('callbacks.admin_menu') ??
            'admin_menu',
        )
        .row();
    }

    if (!session.scenarioId) {
      keyboard
        .text(
          this.localesService.t('menu.choose_scenario'),
          this.constantsService.get<string>('callbacks.select_scenario'),
        )
        .row();
      keyboard
        .text(
          this.localesService.t('menu.attach_bitrix'),
          this.constantsService.get<string>('callbacks.attach_bitrix_id') ??
            'attach_bitrix_id',
        )
        .row();
      keyboard
        .text(
          this.localesService.t('menu.check_balance'),
          this.constantsService.get<string>('callbacks.check_balance'),
        )
        .row();
    } else {
      keyboard
        .text(
          this.localesService.t('menu.choose_another_scenario'),
          this.constantsService.get<string>(
            'callbacks.choose_another_scenario',
          ) ?? 'choose_another_scenario',
        )
        .row();
      keyboard
        .text(
          this.localesService.t('menu.work_with_article'),
          this.constantsService.get<string>('callbacks.work_with_article'),
        )
        .row();
      keyboard
        .text(
          this.localesService.t('menu.attach_bitrix'),
          this.constantsService.get<string>('callbacks.attach_bitrix_id') ??
            'attach_bitrix_id',
        )
        .row();
      keyboard
        .text(
          this.localesService.t('menu.check_balance'),
          this.constantsService.get<string>('callbacks.check_balance'),
        )
        .row();
    }

    const text = messageText || this.localesService.t('menu.title');

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }

  // Scenario 4: User selects scenario
  private async handleSelectScenario(ctx: Context) {
    const scenarios = await this.scenariosService.findAll();
    const keyboard = new InlineKeyboard();
    const scenarioPrefix =
      this.constantsService.get<string>('callbacks.scenario_prefix') ??
      'scenario:';

    for (const scenario of scenarios) {
      keyboard.text(scenario.name, `${scenarioPrefix}${scenario.id}`).row();
    }

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(this.localesService.t('scenarios.title'), {
          reply_markup: keyboard,
        });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(this.localesService.t('scenarios.title'), {
          reply_markup: keyboard,
        });
      }
    } else {
      await ctx.reply(this.localesService.t('scenarios.title'), {
        reply_markup: keyboard,
      });
    }
    await ctx.answerCallbackQuery();
  }

  private async handleScenarioSelected(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    const callbackData = ctx.callbackQuery?.data;
    const scenarioPrefix =
      this.constantsService.get<string>('callbacks.scenario_prefix') ??
      'scenario:';

    if (!callbackData || !callbackData.startsWith(scenarioPrefix)) {
      return;
    }

    const scenarioId = callbackData.replace(scenarioPrefix, '');
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (session) {
      await this.sessionsService.updateScenario(session.id, scenarioId);
    } else {
      // Should not happen normally if flow is followed, but safe to handle
      const newSession = await this.sessionsService.create(user.id);
      await this.sessionsService.updateScenario(newSession.id, scenarioId);
    }

    const scenario = await this.scenariosService.findById(scenarioId);
    const scenarioName = scenario ? scenario.name : 'Unknown';

    await this.handleStart(
      ctx,
      this.localesService.t('scenarios.selected', { scenario: scenarioName }),
    );
    await ctx.answerCallbackQuery();
  }

  // Scenario 6: User works with article
  private async handleWorkWithArticle(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    // Reset any state when returning to menu
    await this.deleteUserState(user.id);
    await this.deleteUserContext(user.id);

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.scenarioId) return;

    const scenario = await this.scenariosService.findById(session.scenarioId);
    const scenarioName = scenario ? scenario.name : 'Unknown';

    let articleTitle = 'Не выбрана';
    let hasArticle = false;
    let hasFactCheck = false;
    let hasBitrixTask = false;
    let uniquenessStatus = this.localesService.t(
      'article_menu.uniqueness_not_checked',
    );

    if (session.articleId) {
      const article = await this.articlesService.findById(session.articleId);
      if (article) {
        articleTitle = article.title;
        const articleAddition = article.additions.find(
          (a) => a.type === ArticleAdditionType.ARTICLE,
        );
        if (articleAddition) {
          hasArticle = true;
        }
        const factCheckAddition = article.additions.find(
          (a) => a.type === ArticleAdditionType.FACT_CHECK,
        );
        if (factCheckAddition) {
          hasFactCheck = true;
        }

        const bitrixTaskAddition = article.additions.find(
          (a) => a.type === ArticleAdditionType.BITRIX_TASK,
        );
        if (bitrixTaskAddition) {
          hasBitrixTask = true;
        }

        const uniqAddition = article.additions.find(
          (a) => a.type === ArticleAdditionType.ARTICLE_UNIQ_CHECK,
        );
        const technicalAddition =
          await this.technicalArticleAdditionsService.findLatestByArticleId(
            article.id,
          );

        const inProgressStates = new Set<TechnicalArticleAdditionState>([
          TechnicalArticleAdditionState.NEW,
          TechnicalArticleAdditionState.RUNNING,
          TechnicalArticleAdditionState.PENDING,
        ]);

        if (
          technicalAddition &&
          inProgressStates.has(technicalAddition.state)
        ) {
          uniquenessStatus = this.localesService.t(
            'article_menu.uniqueness_in_progress',
          );
        } else if (
          technicalAddition?.state === TechnicalArticleAdditionState.ERROR
        ) {
          uniquenessStatus = this.localesService.t(
            'article_menu.uniqueness_need_repeat',
          );
        } else if (
          uniqAddition &&
          articleAddition &&
          articleAddition.updatedAt > uniqAddition.updatedAt
        ) {
          uniquenessStatus = this.localesService.t(
            'article_menu.uniqueness_need_repeat',
          );
        } else if (uniqAddition?.content) {
          const match = uniqAddition.content.match(/\d+([.,]\d+)?/);
          const percent = match
            ? match[0].replace(',', '.')
            : uniqAddition.content;
          uniquenessStatus = this.localesService.t(
            'article_menu.uniqueness_value',
            { percent },
          );
        }
      }
    }

    const nextStep = !hasArticle
      ? this.localesService.t('article_menu.next_step_article')
      : hasFactCheck
        ? this.localesService.t('article_menu.next_step_products')
        : this.localesService.t('article_menu.next_step_fact_check');

    const text = this.localesService.t('article_menu.title', {
      scenario: scenarioName,
      article: articleTitle,
      nextStep,
      uniqueness: uniquenessStatus,
    });

    const keyboard = new InlineKeyboard();

    // Row 1: Create article
    keyboard
      .text(
        this.localesService.t('menu.create_article'),
        this.constantsService.get<string>('callbacks.create_article') ??
          'create_article',
      )
      .row();

    // Row 2: Fact check (if article exists)
    if (hasArticle) {
      keyboard.text(
        this.localesService.t('menu.fact_check_generation') ??
          'Факт-чек (генерация)',
        this.constantsService.get<string>('callbacks.fact_check_generation') ??
          'fact_check_generation',
      );

      if (hasFactCheck) {
        keyboard.text(
          this.localesService.t('menu.fact_check_rewrite') ??
            'Факт-чек (переписать статью)',
          this.constantsService.get<string>('callbacks.fact_check_rewrite') ??
            'fact_check_rewrite',
        );
      }
      keyboard.row();

      if (hasFactCheck) {
        keyboard.text(
          this.localesService.t('menu.products') ?? 'Продукты',
          this.constantsService.get<string>('callbacks.products') ?? 'products',
        );
        keyboard.text(
          this.localesService.t('menu.rubrics') ?? 'Рубрики',
          this.constantsService.get<string>('callbacks.rubrics') ?? 'rubrics',
        );
        keyboard.text(
          this.localesService.t('menu.seo_optimization') ?? 'SEO оптимизация',
          this.constantsService.get<string>('callbacks.seo_optimization') ??
            'seo_optimization',
        );
        keyboard.row();
      }

      keyboard.text(
        this.localesService.t('menu.check_uniqueness') ??
          'Проверить текст на уникальность',
        this.constantsService.get<string>('callbacks.check_uniqueness') ??
          'check_uniqueness',
      );
      keyboard.row();

      keyboard.text(
        this.localesService.t('menu.download_files') ?? 'Скачать файлы',
        this.constantsService.get<string>('callbacks.download_files') ??
          'download_files',
      );
      keyboard.row();

      if (hasFactCheck && !hasBitrixTask) {
        keyboard.text(
          this.localesService.t('article.create_bitrix_task') ??
            'Создать задачу',
          this.constantsService.get<string>('callbacks.create_bitrix_task') ??
            'create_bitrix_task',
        );
        keyboard.row();
      }
    }

    // Row 6: Main menu, Check balance
    keyboard.text(
      this.localesService.t('menu.main_menu'),
      this.constantsService.get<string>('callbacks.main_menu') ?? 'main_menu',
    );
    keyboard
      .text(
        this.localesService.t('menu.check_balance'),
        this.constantsService.get<string>('callbacks.check_balance') ??
          'check_balance',
      )
      .row();

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
    if (ctx.callbackQuery) {
      try {
        await ctx.answerCallbackQuery();
      } catch (error) {
        this.logger.warn(`Failed to answer callback query: ${error}`);
      }
    }
  }

  private async handleCreateArticle(ctx: Context) {
    this.logger.log('Handling create article');
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      this.logger.warn('No telegramId in create article context');
      return;
    }
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) {
      this.logger.warn(`User not found for telegramId: ${telegramId}`);
      return;
    }

    await this.setUserState(user.id, 'WAITING_FOR_TOPIC');
    const message =
      this.localesService.t('article.enter_topic') || 'Введите тему статьи:';
    this.logger.log(`Replying with: ${message}`);
    await ctx.reply(message);
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
  }

  private async handleMessage(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId || !ctx.message?.text) return;

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    const text = ctx.message.text.trim();
    if (text === '/cancel') {
      await this.handleCancel(ctx);
      return;
    }

    if (
      state === 'WAITING_FOR_QUESTIONS_FILE' ||
      state === 'WAITING_FOR_FACT_CHECK_FILE' ||
      state === 'WAITING_FOR_SEO_TZ_FILE'
    ) {
      const message =
        state === 'WAITING_FOR_QUESTIONS_FILE'
          ? this.localesService.t('article.upload_questions') ||
            'Пришлите вопросы в виде файла. Формат файла - docx.\n/cancel — отменить и вернуться в меню работы со статьей.'
          : state === 'WAITING_FOR_FACT_CHECK_FILE'
            ? this.localesService.t('article.upload_fact_check') ||
              'Пришлите факт-чек в виде файла. Формат файла - docx.\n/cancel — отменить и вернуться в меню работы со статьей.'
            : this.localesService.t('article.seo_tz_request') ||
              'Для сео-оптимизации пришлите ТЗ в формате docx.\n/cancel — отменить и вернуться в меню работы со статьей.';
      await ctx.reply(message);
      return;
    }

    if (state === 'WAITING_FOR_SETTING_VALUE') {
      const context = await this.getUserContext(user.id);
      if (!context || !context.settingType || !context.settingParam) {
        await ctx.reply('Ошибка контекста. Попробуйте снова.');
        await this.deleteUserState(user.id);
        return;
      }
      const { settingType, settingParam } = context;
      const value = ctx.message.text;
      const updatePayload: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        files?: string[];
        systemPromptId?: string | null;
        userPromptId?: string | null;
      } = {};

      try {
        if (settingParam === 'temperature') {
          const parsedValue = parseFloat(value.replace(',', '.'));
          if (isNaN(parsedValue)) throw new Error('Invalid number');
          updatePayload.temperature = parsedValue;
        } else if (settingParam === 'maxTokens') {
          const parsedValue = parseInt(value, 10);
          if (isNaN(parsedValue)) throw new Error('Invalid number');
          updatePayload.maxTokens = parsedValue;
        } else if (settingParam === 'files') {
          updatePayload.files = value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        } else if (settingParam === 'model') {
          updatePayload.model = value;
        } else if (settingParam === 'systemPromptId') {
          updatePayload.systemPromptId = value.length > 0 ? value : null;
        } else if (settingParam === 'userPromptId') {
          updatePayload.userPromptId = value.length > 0 ? value : null;
        } else {
          throw new Error('Invalid param');
        }

        await this.generationSettingsService.update(settingType, updatePayload);

        await ctx.reply(
          this.localesService.t('admin.setting_updated', {
            param: settingParam,
            value: value,
          }) || `Параметр ${settingParam} обновлен.`,
        );
        await this.deleteUserState(user.id);
      } catch {
        await ctx.reply('Некорректное значение. Попробуйте снова.');
      }
      return;
    }

    if (state === 'WAITING_FOR_TOPIC') {
      const title = ctx.message.text;
      await this.setUserContext(user.id, { title });
      await this.setUserState(user.id, 'WAITING_FOR_TOPIC_CONFIRMATION');

      const keyboard = new InlineKeyboard()
        .text(
          this.localesService.t('menu.confirm'),
          this.constantsService.get<string>('callbacks.confirm_title') ??
            'confirm_title',
        )
        .row()
        .text(
          this.localesService.t('menu.regenerate'),
          this.constantsService.get<string>('callbacks.reenter_title') ??
            'reenter_title',
        );

      await ctx.reply(
        this.localesService.t('article.confirm_title', { title }),
        { reply_markup: keyboard },
      );
      return;
    }

    if (state === 'WAITING_FOR_BITRIX_ID') {
      const bitrixIdStr = ctx.message.text;
      const bitrixId = parseInt(bitrixIdStr, 10);

      if (isNaN(bitrixId)) {
        await ctx.reply(this.localesService.t('article.bitrix_id_invalid'));
        return;
      }

      await this.usersService.updateBitrixId(user.id, bitrixId);
      await this.deleteUserState(user.id);
      await ctx.reply(this.localesService.t('article.bitrix_id_saved'));
      await this.handleStart(ctx);
      return;
    }
  }

  private async handleCancel(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (
      state === 'WAITING_FOR_TOPIC' ||
      state === 'WAITING_FOR_QUESTIONS_FILE' ||
      state === 'WAITING_FOR_FACT_CHECK_FILE' ||
      state === 'WAITING_FOR_SEO_TZ_FILE' ||
      state === 'WAITING_FOR_BITRIX_ID'
    ) {
      await this.deleteUserState(user.id);
      await this.deleteUserContext(user.id);

      if (state === 'WAITING_FOR_BITRIX_ID') {
        await ctx.reply(
          this.localesService.t('article.input_cancelled') ||
            'Ввод отменен. Возвращаю в начальное меню.',
        );
        await this.handleStart(ctx);
      } else {
        await ctx.reply(
          this.localesService.t('article.input_cancelled') ||
            'Ввод отменен. Возвращаю в меню работы со статьей.',
        );
        await this.handleWorkWithArticle(ctx);
      }

      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery();
      }
      return;
    }

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
  }

  private async handleConfirmTitle(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_TOPIC_CONFIRMATION') {
      return;
    }

    const context = await this.getUserContext(user.id);
    if (!context || !context.title) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }
    const title = context.title;

    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.generating_questions') ||
        'Генерирую вопросы, подождите...',
    );

    // Create article in DB
    const article = await this.articlesService.create(user.id, title);
    await this.setUserContext(user.id, { ...context, articleId: article.id });

    const session = await this.sessionsService.findActive(user.id);
    if (session) {
      await this.sessionsService.updateArticle(session.id, article.id);
    }

    try {
      const questionsResult = await this.bothubService.generateQuestions(
        title,
        this.getUserLogContext(ctx),
      );
      const buffer = await DocxUtil.createDocx(questionsResult.content);

      await ctx.replyWithDocument(new InputFile(buffer, 'questions.docx'));

      // Save context for regeneration/confirmation
      await this.setUserContext(user.id, {
        ...context,
        articleId: article.id,
        questions: questionsResult.content,
      });
      await this.setUserState(user.id, 'WAITING_FOR_QUESTIONS_CONFIRMATION');

      const keyboard = new InlineKeyboard()
        .text(
          this.localesService.t('menu.confirm'),
          this.constantsService.get<string>('callbacks.confirm_questions') ??
            'confirm_questions',
        )
        .row()
        .text(
          this.localesService.t('menu.edit_questions'),
          this.constantsService.get<string>('callbacks.edit_questions') ??
            'edit_questions',
        )
        .row()
        .text(
          this.localesService.t('menu.restart'),
          this.constantsService.get<string>('callbacks.restart_process') ??
            'restart_process',
        );

      await ctx.reply(
        this.localesService.t('article.questions_generated', {
          usage: (questionsResult.usage ?? 'неизвестно').toString(),
        }) || 'Вопросы сгенерированы. Подтвердите или сгенерируйте заново.',
        { reply_markup: keyboard },
      );
    } catch (error) {
      await this.logGenerationError(ctx, 'generate_questions', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleConfirmQuestions(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_QUESTIONS_CONFIRMATION') {
      return;
    }

    const context = await this.getUserContext(user.id);
    if (
      !context ||
      !context.articleId ||
      !context.questions ||
      !context.title
    ) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }
    const articleId = context.articleId;
    const questions = context.questions;
    const title = context.title;

    await ctx.answerCallbackQuery();

    await this.generateArticleFromQuestions(ctx, {
      userId: user.id,
      articleId,
      title,
      questions,
      context,
    });
  }

  private async handleEditQuestions(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_QUESTIONS_CONFIRMATION') {
      return;
    }

    await this.setUserState(user.id, 'WAITING_FOR_QUESTIONS_FILE');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.upload_questions') ||
        'Пришлите вопросы в виде файла. Формат файла - docx.\n/cancel — отменить и вернуться в меню работы со статьей.',
    );
  }

  private async generateArticleFromQuestions(
    ctx: Context,
    payload: {
      userId: string;
      articleId: string;
      title: string;
      questions: string;
      context: UserContext;
    },
  ) {
    const { userId, articleId, title, questions, context } = payload;

    await this.articlesService.addAddition(
      articleId,
      ArticleAdditionType.QUESTION,
      questions,
    );

    await ctx.reply(
      this.localesService.t('article.generating_article') ||
        'Генерирую статью, подождите...',
    );

    try {
      const articleResult = await this.bothubService.generateArticle(
        title,
        questions,
        this.getUserLogContext(ctx),
      );
      const buffer = await DocxUtil.createDocx(articleResult.content);

      await ctx.replyWithDocument(new InputFile(buffer, 'article.docx'));

      await this.setUserContext(userId, {
        ...context,
        articleContent: articleResult.content,
      });
      await this.setUserState(userId, 'WAITING_FOR_ARTICLE_CONFIRMATION');

      const keyboard = new InlineKeyboard()
        .text(
          this.localesService.t('menu.confirm'),
          this.constantsService.get<string>('callbacks.confirm_article') ??
            'confirm_article',
        )
        .row()
        .text(
          this.localesService.t('menu.restart'),
          this.constantsService.get<string>('callbacks.restart_process') ??
            'restart_process',
        );

      await ctx.reply(
        this.localesService.t('article.article_generated', {
          usage: (articleResult.usage ?? 'неизвестно').toString(),
        }) || 'Статья сгенерирована.',
        { reply_markup: keyboard },
      );
    } catch (error) {
      await this.logGenerationError(ctx, 'generate_article', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleConfirmArticle(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_ARTICLE_CONFIRMATION') {
      return;
    }

    const context = await this.getUserContext(user.id);
    if (!context || !context.articleId || !context.articleContent) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }
    const articleId = context.articleId;
    const articleContent = context.articleContent;

    await ctx.answerCallbackQuery();

    // Save article to DB
    await this.articlesService.addAddition(
      articleId,
      ArticleAdditionType.ARTICLE,
      articleContent,
    );

    await this.deleteUserState(user.id);
    await this.deleteUserContext(user.id);

    await ctx.reply(this.localesService.t('article.article_confirmed'));

    await this.handleWorkWithArticle(ctx);
  }

  private async handleFactCheckGeneration(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) return;

    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.generating_fact_check') ||
        'Генерирую факт-чек, подождите...',
    );

    try {
      const result = await this.bothubService.generateFactCheck(
        article.title,
        articleAddition.content,
        this.getUserLogContext(ctx),
      );
      const buffer = await DocxUtil.createDocx(result.content);

      await ctx.replyWithDocument(new InputFile(buffer, 'fact_check.docx'));

      await ctx.reply(
        this.localesService.t('article.fact_check_generated', {
          usage: (result.usage ?? 'неизвестно').toString(),
        }) || 'Факт-чек сгенерирован.',
      );

      await this.articlesService.addAddition(
        article.id,
        ArticleAdditionType.FACT_CHECK,
        result.content,
      );
      await this.deleteUserState(user.id);
      await this.deleteUserContext(user.id);
      await this.handleWorkWithArticle(ctx);
    } catch (error) {
      await this.logGenerationError(ctx, 'generate_fact_check', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleEditFactCheck(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_FACT_CHECK_CONFIRMATION') {
      return;
    }

    await this.setUserState(user.id, 'WAITING_FOR_FACT_CHECK_FILE');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.upload_fact_check') ||
        'Пришлите факт-чек в виде файла. Формат файла - docx.\n/cancel — отменить и вернуться в меню работы со статьей.',
    );
  }

  private async handleFactCheckRewrite(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) return;

    // Check if fact check exists
    const factCheckAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.FACT_CHECK,
    );
    if (!factCheckAddition) {
      await ctx.reply(
        this.localesService.t('errors.fact_check_not_found') ||
          'Сначала сгенерируйте факт-чек.',
      );
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.rewriting_article') ||
        'Переписываю статью, подождите...',
    );

    try {
      const result = await this.bothubService.rewriteArticle(
        article.title,
        articleAddition.content,
        factCheckAddition.content,
        this.getUserLogContext(ctx),
      );

      // Save old version
      await this.articlesService.createVersion(
        article.id,
        articleAddition.content,
      );

      // Update article content
      await this.articlesService.updateAddition(
        article.id,
        ArticleAdditionType.ARTICLE,
        result.content,
      );

      const buffer = await DocxUtil.createDocx(result.content);

      await ctx.replyWithDocument(
        new InputFile(buffer, 'rewritten_article.docx'),
      );

      await ctx.reply(
        this.localesService.t('article.article_rewritten', {
          usage: (result.usage ?? 'неизвестно').toString(),
        }) || 'Статья переписана.',
      );

      await this.handleWorkWithArticle(ctx);
    } catch (error) {
      await this.logGenerationError(ctx, 'rewrite_article', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleConfirmFactCheck(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_FACT_CHECK_CONFIRMATION') return;

    const context = await this.getUserContext(user.id);
    if (!context || !context.articleId || !context.factCheckContent) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }
    const articleId = context.articleId;
    const factCheckContent = context.factCheckContent;

    await ctx.answerCallbackQuery();

    await this.saveFactCheckFromText(ctx, user.id, articleId, factCheckContent);
  }

  private async saveFactCheckFromText(
    ctx: Context,
    userId: string,
    articleId: string,
    factCheckContent: string,
  ) {
    await this.articlesService.addAddition(
      articleId,
      ArticleAdditionType.FACT_CHECK,
      factCheckContent,
    );

    await this.deleteUserState(userId);
    await this.deleteUserContext(userId);

    await ctx.reply(
      this.localesService.t('article.fact_check_confirmed') ||
        'Факт-чек сохранен.',
    );

    await this.handleWorkWithArticle(ctx);
  }

  private async handleDocument(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;
    const document = ctx.message?.document;
    if (!document) return;

    const state = await this.getUserState(user.id);
    if (
      state !== 'WAITING_FOR_QUESTIONS_FILE' &&
      state !== 'WAITING_FOR_FACT_CHECK_FILE' &&
      state !== 'WAITING_FOR_SEO_TZ_FILE'
    ) {
      return;
    }

    if (!this.isDocxDocument(document)) {
      await ctx.reply(
        this.localesService.t('errors.invalid_docx_format') ||
          'Нужен файл в формате docx. Попробуйте еще раз.\n/cancel — отменить и вернуться в меню работы со статьей.',
      );
      return;
    }

    const buffer = await this.downloadDocumentBuffer(document.file_id);
    if (!buffer) {
      await ctx.reply(
        this.localesService.t('errors.docx_read_failed') ||
          'Не удалось прочитать файл. Попробуйте еще раз.\n/cancel — отменить и вернуться в меню работы со статьей.',
      );
      return;
    }

    const text = await DocxUtil.extractText(buffer);
    if (!text) {
      await ctx.reply(
        this.localesService.t('errors.docx_empty') ||
          'Файл пустой. Попробуйте еще раз.\n/cancel — отменить и вернуться в меню работы со статьей.',
      );
      return;
    }

    if (state === 'WAITING_FOR_QUESTIONS_FILE') {
      const context = await this.getUserContext(user.id);
      if (!context || !context.articleId || !context.title) {
        await ctx.reply(this.localesService.t('errors.generation_failed'));
        return;
      }
      await this.generateArticleFromQuestions(ctx, {
        userId: user.id,
        articleId: context.articleId,
        title: context.title,
        questions: text,
        context: { ...context, questions: text },
      });
      return;
    }

    if (state === 'WAITING_FOR_FACT_CHECK_FILE') {
      const context = await this.getUserContext(user.id);
      if (!context || !context.articleId) {
        await ctx.reply(this.localesService.t('errors.generation_failed'));
        return;
      }
      await this.saveFactCheckFromText(ctx, user.id, context.articleId, text);
      return;
    }

    const context = await this.getUserContext(user.id);
    if (!context || !context.articleId) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }

    await this.articlesService.updateAddition(
      context.articleId,
      ArticleAdditionType.SEO_TZ,
      text,
    );

    await ctx.reply(
      this.localesService.t('article.seo_tz_received') ||
        'ТЗ получил. Начинаю генерацию текста...',
    );

    const article = await this.articlesService.findById(context.articleId);
    if (!article) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) {
      await ctx.reply(
        this.localesService.t('errors.article_not_found') ||
          'Сначала сгенерируйте статью.',
      );
      return;
    }

    try {
      const result = await this.bothubService.seoRewriteArticle(
        articleAddition.content,
        text,
        this.getUserLogContext(ctx),
      );

      await this.articlesService.createVersion(
        context.articleId,
        articleAddition.content,
      );
      await this.articlesService.updateAddition(
        context.articleId,
        ArticleAdditionType.ARTICLE,
        result.content,
      );

      const buffer = await DocxUtil.createDocx(result.content);
      await ctx.replyWithDocument(new InputFile(buffer, 'seo_article.docx'));

      await ctx.reply(
        (
          this.localesService.t('article.seo_article_generated', {
            usage: (result.usage ?? 'неизвестно').toString(),
          }) ||
          'SEO-оптимизированная статья готова.\nПотрачено токенов: {{usage}}'
        ).replace('{{usage}}', (result.usage ?? 'неизвестно').toString()),
      );

      await this.deleteUserState(user.id);
      await this.deleteUserContext(user.id);
      await this.handleWorkWithArticle(ctx);
    } catch (error) {
      await this.logGenerationError(ctx, 'seo_rewrite_article', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private isDocxDocument(document: {
    file_name?: string;
    mime_type?: string;
  }): boolean {
    const fileName = document.file_name?.toLowerCase() ?? '';
    const mimeType = document.mime_type?.toLowerCase() ?? '';
    return (
      fileName.endsWith('.docx') ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }

  private async downloadDocumentBuffer(fileId: string): Promise<Buffer | null> {
    if (!this.botToken) return null;
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) return null;
    const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async handleConfirmRewrite(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);
    if (state !== 'WAITING_FOR_REWRITE_CONFIRMATION') return;

    const context = await this.getUserContext(user.id);
    if (
      !context ||
      !context.articleId ||
      !context.rewrittenArticleContent ||
      !context.articleContent
    ) {
      await ctx.reply(this.localesService.t('errors.generation_failed'));
      return;
    }
    const articleId = context.articleId;
    const rewrittenArticleContent = context.rewrittenArticleContent;
    const articleContent = context.articleContent;

    await ctx.answerCallbackQuery();

    // Move old content to versions
    await this.articlesService.createVersion(articleId, articleContent);

    // Update current content
    await this.articlesService.updateAddition(
      articleId,
      ArticleAdditionType.ARTICLE,
      rewrittenArticleContent,
    );

    await ctx.reply(this.localesService.t('article.article_rewritten'));

    await this.handleWorkWithArticle(ctx);
  }

  private async handleSeoOptimization(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) {
      await ctx.answerCallbackQuery({
        text:
          this.localesService.t('errors.article_not_found') ||
          'Сначала сгенерируйте статью',
        show_alert: true,
      });
      return;
    }

    const factCheckAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.FACT_CHECK,
    );
    if (!factCheckAddition) {
      await ctx.reply(
        this.localesService.t('errors.fact_check_not_found') ||
          'Сначала сгенерируйте факт-чек.',
      );
      return;
    }

    await this.setUserContext(user.id, { articleId: article.id });
    await this.setUserState(user.id, 'WAITING_FOR_SEO_TZ_FILE');

    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.seo_tz_request') ||
        'Для сео-оптимизации пришлите ТЗ в формате docx.',
    );
  }

  private async handleCheckUniqueness(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) {
      await ctx.answerCallbackQuery({
        text:
          this.localesService.t('errors.article_not_found') ||
          'Сначала сгенерируйте статью',
        show_alert: true,
      });
      return;
    }

    const activeCheck =
      await this.technicalArticleAdditionsService.findActiveByArticleId(
        article.id,
      );
    if (activeCheck) {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        this.localesService.t('article.uniqueness_check_in_progress') ||
          'Текущая проверка в процессе, пожалуйста, подождите.',
      );
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const textUid = await this.textRuService.createCheck(
        articleAddition.content,
        this.getUserLogContext(ctx),
      );
      await this.technicalArticleAdditionsService.create(
        article.id,
        TechnicalArticleAdditionState.NEW,
        JSON.stringify({ textUid }),
      );

      await this.articlesService.updateAddition(
        article.id,
        ArticleAdditionType.ARTICLE_UNIQ_CHECK,
        this.localesService.t('article_menu.uniqueness_in_progress') ||
          'Проверка в процессе',
      );

      await ctx.reply(
        this.localesService.t('article.uniqueness_check_created') ||
          'Задание на проверку уникальности создано. Как будет завершено, я сообщу.',
      );
      await this.handleWorkWithArticle(ctx);
    } catch (error) {
      await this.logGenerationError(ctx, 'text_ru_create_check', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleRubrics(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) {
      await ctx.answerCallbackQuery({
        text:
          this.localesService.t('errors.article_not_found') ||
          'Сначала сгенерируйте статью',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.generating_rubrics') ||
        'Подбираю рубрики, подождите...',
    );

    try {
      const result = await this.bothubService.generateRubrics(
        articleAddition.content,
        this.getUserLogContext(ctx),
      );
      const buffer = await DocxUtil.createDocx(result.content);

      await ctx.replyWithDocument(new InputFile(buffer, 'rubrics.docx'));

      await this.articlesService.addAddition(
        article.id,
        ArticleAdditionType.RUBRIC,
        result.content,
      );

      await ctx.reply(
        (
          this.localesService.t('article.rubrics_generated', {
            usage: (result.usage ?? 'неизвестно').toString(),
          }) || 'Рубрики готовы (токенов: {{usage}}).'
        ).replace('{{usage}}', (result.usage ?? 'неизвестно').toString()),
      );

      await this.handleWorkWithArticle(ctx);
    } catch (error) {
      await this.logGenerationError(ctx, 'generate_rubrics', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleProducts(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    if (!articleAddition) {
      await ctx.answerCallbackQuery({
        text:
          this.localesService.t('errors.article_not_found') ||
          'Сначала сгенерируйте статью',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      this.localesService.t('article.generating_products') ||
        'Подбираю продукты, подождите...',
    );

    try {
      const result = await this.bothubService.generateProducts(
        articleAddition.content,
        this.getUserLogContext(ctx),
      );
      const buffer = await DocxUtil.createDocx(result.content);

      await ctx.replyWithDocument(new InputFile(buffer, 'products.docx'));

      await this.articlesService.addAddition(
        article.id,
        ArticleAdditionType.PRODUCT,
        result.content,
      );

      await ctx.reply(
        this.localesService.t('article.products_generated', {
          usage: (result.usage ?? 'неизвестно').toString(),
        }) || 'Продукты готовы.',
      );

      await this.handleWorkWithArticle(ctx);
    } catch (error) {
      await this.logGenerationError(ctx, 'generate_products', error);
      this.logger.error(error);
      await ctx.reply(this.localesService.t('errors.generation_failed'));
    }
  }

  private async handleAdminMenu(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') {
      return;
    }

    const text = this.localesService.t('menu.admin_title', {
      firstName: user.firstName ?? 'Admin',
    });

    const keyboard = new InlineKeyboard()
      .text(
        this.localesService.t('menu.admin_users'),
        this.constantsService.get<string>('callbacks.admin_users') ??
          'admin_users',
      )
      .row()
      .text(
        this.localesService.t('menu.admin_settings'),
        this.constantsService.get<string>('callbacks.admin_settings') ??
          'admin_settings',
      )
      .row()
      .url(
        this.localesService.t('menu.admin_prompts'),
        'https://outline.rilokobotfactory3.ru/',
      )
      .row()
      .text(
        this.localesService.t('menu.admin_back_to_main'),
        this.constantsService.get<string>('callbacks.admin_back_to_main') ??
          'admin_back_to_main',
      );

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }

  private async handleAdminUsers(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') {
      return;
    }

    const text = this.localesService.t('menu.admin_users');

    const keyboard = new InlineKeyboard()
      .text(
        this.localesService.t('menu.admin_users_list'),
        'admin_users_list_stub',
      )
      .row()
      .text(
        this.localesService.t('menu.admin_users_activate'),
        'admin_users_activate_stub',
      )
      .row()
      .text(
        this.localesService.t('menu.admin_users_delete'),
        'admin_users_delete_stub',
      )
      .row()
      .text(
        this.localesService.t('menu.admin_back_to_admin'),
        this.constantsService.get<string>('callbacks.admin_back_to_admin') ??
          'admin_back_to_admin',
      );

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
      await ctx.answerCallbackQuery();
    }
  }

  private async handleAdminSettings(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') {
      return;
    }

    const text = this.localesService.t('menu.admin_settings');

    const adminSettingsViewCallback =
      this.constantsService.get<string>('callbacks.admin_settings_view') ??
      'admin_settings_view';
    const adminSettingsEditCallback =
      this.constantsService.get<string>('callbacks.admin_settings_edit') ??
      'admin_settings_edit';
    const adminBackToAdminCallback =
      this.constantsService.get<string>('callbacks.admin_back_to_admin') ??
      'admin_back_to_admin';

    const keyboard = new InlineKeyboard()
      .text(
        this.localesService.t('menu.admin_settings_view'),
        adminSettingsViewCallback,
      )
      .row()
      .text(
        this.localesService.t('menu.admin_settings_edit'),
        adminSettingsEditCallback,
      )
      .row()
      .text(
        this.localesService.t('menu.admin_back_to_admin'),
        adminBackToAdminCallback,
      );

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
      await ctx.answerCallbackQuery();
    }
  }

  private async handleAdminSettingsView(ctx: Context) {
    await this.showSettingsTypeMenu(ctx, 'admin_settings_view');
  }

  private async handleAdminSettingsEdit(ctx: Context) {
    await this.showSettingsTypeMenu(ctx, 'admin_settings_edit');
  }

  private async showSettingsTypeMenu(
    ctx: Context,
    action: 'admin_settings_view' | 'admin_settings_edit',
  ) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') {
      return;
    }

    const settings = await this.generationSettingsService.getAll();
    const keyboard = new InlineKeyboard();

    for (const setting of settings) {
      const label =
        this.localesService.t(`settings_types.${setting.type}`) !==
        `settings_types.${setting.type}`
          ? this.localesService.t(`settings_types.${setting.type}`)
          : setting.type;
      keyboard.text(label, `${action}:${setting.type}`).row();
    }

    const adminBackToAdminCallback =
      this.constantsService.get<string>('callbacks.admin_back_to_admin') ??
      'admin_back_to_admin';

    keyboard.text(
      this.localesService.t('menu.admin_back_to_admin'),
      adminBackToAdminCallback,
    );

    const text =
      action === 'admin_settings_view'
        ? this.localesService.t('menu.admin_settings_view_title') ||
          'Выберите тип генерации для просмотра:'
        : this.localesService.t('menu.admin_settings_edit_title') ||
          'Выберите тип генерации для изменения:';

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
      await ctx.answerCallbackQuery();
    }
  }

  private async handleAdminSettingsViewType(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') return;

    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const type = data.replace('admin_settings_view:', '');
    const settings = await this.generationSettingsService.getByType(type);

    if (!settings) {
      await ctx.answerCallbackQuery({
        text: 'Настройки не найдены',
        show_alert: true,
      });
      return;
    }

    const escapeMarkdown = (
      text: string | number | null | undefined,
    ): string => {
      if (text === null || text === undefined) return 'Нет';
      return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    };

    const message = `
*Тип:* ${escapeMarkdown(settings.type)}
*Модель:* ${escapeMarkdown(settings.model)}
*Температура:* ${escapeMarkdown(settings.temperature)}
*Max Tokens:* ${escapeMarkdown(settings.maxTokens)}
*Файлы:* ${settings.files.length} шт.
*System Prompt ID:* ${escapeMarkdown(settings.systemPromptId)}
*User Prompt ID:* ${escapeMarkdown(settings.userPromptId)}
    `;

    const adminSettingsViewCallback =
      this.constantsService.get<string>('callbacks.admin_settings_view') ??
      'admin_settings_view';

    const keyboard = new InlineKeyboard().text(
      this.localesService.t('menu.back'),
      adminSettingsViewCallback,
    );

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(message, {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(message, {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        });
      }
      await ctx.answerCallbackQuery();
    }
  }

  private async handleAdminSettingsEditType(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') return;

    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const type = data.replace('admin_settings_edit:', '');
    // Check if settings exist
    const settings = await this.generationSettingsService.getByType(type);
    if (!settings) {
      await ctx.answerCallbackQuery({
        text: 'Настройки не найдены',
        show_alert: true,
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    const params = [
      'model',
      'temperature',
      'maxTokens',
      'files',
      'systemPromptId',
      'userPromptId',
    ];

    for (const param of params) {
      keyboard.text(param, `admin_settings_param:${type}:${param}`).row();
    }

    const adminSettingsEditCallback =
      this.constantsService.get<string>('callbacks.admin_settings_edit') ??
      'admin_settings_edit';

    keyboard.text(
      this.localesService.t('menu.back'),
      adminSettingsEditCallback,
    );

    const text =
      this.localesService.t('menu.admin_settings_edit_param_title') ||
      'Выберите параметр для изменения:';

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch (e) {
        this.logger.warn(`Failed to edit message: ${e}`);
        await ctx.reply(text, { reply_markup: keyboard });
      }
      await ctx.answerCallbackQuery();
    }
  }

  private async handleAdminSettingsEditParam(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user || user.role !== 'admin') return;

    const data = ctx.callbackQuery?.data;
    if (!data) return;

    // Format: admin_settings_param:<type>:<param>
    const parts = data.split(':');
    if (parts.length < 3) return;
    const type = parts[1];
    const param = parts[2];

    await this.setUserState(user.id, 'WAITING_FOR_SETTING_VALUE');
    await this.setUserContext(user.id, {
      settingType: type,
      settingParam: param,
    });

    const message =
      this.localesService.t('admin.enter_new_value', { param }) ||
      `Введите новое значение для ${param}:`;

    await ctx.reply(message);
    await ctx.answerCallbackQuery();
  }

  private async handleDownloadMenu(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const downloadPrefix =
      this.constantsService.get<string>('callbacks.download_prefix') ??
      'download:';
    const returnToArticleMenuCallback =
      this.constantsService.get<string>('callbacks.return_to_article_menu') ??
      'return_to_article_menu';

    const options = [
      {
        type: ArticleAdditionType.ARTICLE,
        labelKey: 'download_menu.article',
        fallback: 'Скачать текст статьи',
      },
      {
        type: ArticleAdditionType.FACT_CHECK,
        labelKey: 'download_menu.fact_check',
        fallback: 'Скачать факт-чек',
      },
      {
        type: ArticleAdditionType.RUBRIC,
        labelKey: 'download_menu.rubrics',
        fallback: 'Скачать рубрики',
      },
      {
        type: ArticleAdditionType.PRODUCT,
        labelKey: 'download_menu.products',
        fallback: 'Скачать продукты',
      },
      {
        type: ArticleAdditionType.QUESTION,
        labelKey: 'download_menu.questions',
        fallback: 'Скачать вопросы',
      },
    ];

    const keyboard = new InlineKeyboard();
    let hasFiles = false;

    for (const option of options) {
      const addition = article.additions.find((a) => a.type === option.type);
      if (!addition) continue;
      hasFiles = true;
      keyboard.text(
        this.localesService.t(option.labelKey) ?? option.fallback,
        `${downloadPrefix}${option.type}`,
      );
      keyboard.row();
    }

    keyboard.text(
      this.localesService.t('download_menu.return_to_menu') ??
        'Вернуться к основному меню',
      returnToArticleMenuCallback,
    );

    await ctx.answerCallbackQuery();
    if (!hasFiles) {
      await ctx.reply(
        this.localesService.t('download_menu.no_files') ||
          'Для этой статьи пока нет файлов.',
        { reply_markup: keyboard },
      );
      return;
    }

    await ctx.reply(
      this.localesService.t('download_menu.title') ||
        'Доступные файлы для скачивания:',
      { reply_markup: keyboard },
    );
  }

  private async handleDownloadItem(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId) return;

    const article = await this.articlesService.findById(session.articleId);
    if (!article) return;

    const callbackData = ctx.callbackQuery?.data ?? '';
    const downloadPrefix =
      this.constantsService.get<string>('callbacks.download_prefix') ??
      'download:';
    if (!callbackData.startsWith(downloadPrefix)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const type = callbackData.replace(downloadPrefix, '');
    const allowedTypes = new Set<string>([
      ArticleAdditionType.ARTICLE,
      ArticleAdditionType.FACT_CHECK,
      ArticleAdditionType.RUBRIC,
      ArticleAdditionType.PRODUCT,
      ArticleAdditionType.QUESTION,
    ]);
    if (!allowedTypes.has(type)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const addition = article.additions.find(
      (a) => a.type === (type as ArticleAdditionType),
    );
    if (!addition) {
      await ctx.reply(
        this.localesService.t('download_menu.no_files') ||
          'Для этой статьи пока нет файлов.',
      );
      return;
    }

    const fileNameMap: Record<string, string> = {
      [ArticleAdditionType.ARTICLE]: 'article.docx',
      [ArticleAdditionType.FACT_CHECK]: 'fact_check.docx',
      [ArticleAdditionType.RUBRIC]: 'rubrics.docx',
      [ArticleAdditionType.PRODUCT]: 'products.docx',
      [ArticleAdditionType.QUESTION]: 'questions.docx',
    };

    const buffer = await DocxUtil.createDocx(addition.content);
    await ctx.replyWithDocument(
      new InputFile(buffer, fileNameMap[type] ?? 'content.docx'),
    );
    await ctx.answerCallbackQuery();
  }

  private async handleAttachBitrixId(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    await this.setUserState(user.id, 'WAITING_FOR_BITRIX_ID');
    await ctx.answerCallbackQuery();
    await ctx.reply(this.localesService.t('article.bitrix_id_request'));
  }

  private async handleCreateBitrixTask(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const session = await this.sessionsService.findActive(user.id);
    if (!session || !session.articleId || !session.scenarioId) return;

    const scenario = await this.scenariosService.findById(session.scenarioId);
    const article = await this.articlesService.findById(session.articleId);
    if (!scenario || !article) return;

    const articleAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE,
    );
    const uniqAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.ARTICLE_UNIQ_CHECK,
    );
    const rubricAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.RUBRIC,
    );
    const productAddition = article.additions.find(
      (a) => a.type === ArticleAdditionType.PRODUCT,
    );

    if (!articleAddition) {
      await ctx.answerCallbackQuery({
        text: this.localesService.t('errors.article_not_found'),
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(this.localesService.t('article.bitrix_task_creating'));

    const uniqueness = uniqAddition?.content ? uniqAddition.content : '0';
    const title = `${scenario.name} статья на размещение ${article.title}`;
    const description = `Разместить статью. Тема: ${article.title}. Уникальность: ${uniqueness}%. Вся необходимая информация находится во вложениях к задаче`;

    try {
      const taskId = await this.bitrixService.createTask({
        title,
        description,
        createdBy: user.bitrixId || undefined,
        userContext: this.getUserLogContext(ctx),
      });

      // Save task ID to DB
      await this.articlesService.updateAddition(
        article.id,
        ArticleAdditionType.BITRIX_TASK,
        taskId.toString(),
      );

      // Prepare files for Bitrix
      const filesToUpload: Array<{ name: string; content: string }> = [];

      // Article
      const articleBuffer = await DocxUtil.createDocx(articleAddition.content);
      filesToUpload.push({
        name: 'article.docx',
        content: articleBuffer.toString('base64'),
      });

      // Rubrics
      if (rubricAddition) {
        const rubricBuffer = await DocxUtil.createDocx(rubricAddition.content);
        filesToUpload.push({
          name: 'rubrics.docx',
          content: rubricBuffer.toString('base64'),
        });
      }

      // Products
      if (productAddition) {
        const productBuffer = await DocxUtil.createDocx(productAddition.content);
        filesToUpload.push({
          name: 'products.docx',
          content: productBuffer.toString('base64'),
        });
      }

      // Upload files
      await this.bitrixService.uploadTaskFiles(
        taskId,
        filesToUpload,
        this.getUserLogContext(ctx),
      );

      const taskUrl = this.bitrixService.generateTaskUrl(taskId);
      await ctx.reply(this.localesService.t('article.bitrix_task_created', { taskUrl }));

      // Finish cycle
      await this.sessionsService.delete(session.id);
      await this.deleteUserState(user.id);
      await this.deleteUserContext(user.id);

      await this.handleStart(ctx);
    } catch (error) {
      this.logger.error(`Error creating Bitrix task: ${error}`);
      await ctx.reply(this.localesService.t('article.bitrix_task_error'));
    }
  }

  private async processUniquenessChecks() {
    const items = await this.technicalArticleAdditionsService.findActive();
    const now = new Date().getTime();

    for (const item of items) {
      const createdAt = item.createdAt.getTime();
      if (now - createdAt > 60 * 60 * 1000) {
        await this.technicalArticleAdditionsService.update(item.id, {
          state: TechnicalArticleAdditionState.ERROR,
          message: 'Не удалось получить проверку',
        });
        await this.notifyUniquenessError(item.articleId);
        continue;
      }

      if (
        item.state === TechnicalArticleAdditionState.PENDING &&
        now - item.updatedAt.getTime() < 45 * 1000
      ) {
        continue;
      }

      if (item.state === TechnicalArticleAdditionState.NEW) {
        await this.technicalArticleAdditionsService.update(item.id, {
          state: TechnicalArticleAdditionState.RUNNING,
        });
      }

      const textUid = this.extractTextUid(item.technicalInfo);
      if (!textUid) {
        await this.technicalArticleAdditionsService.update(item.id, {
          state: TechnicalArticleAdditionState.ERROR,
          message: 'Не удалось получить идентификатор проверки',
        });
        await this.notifyUniquenessError(item.articleId);
        continue;
      }

      const result = await this.textRuService.getResult(textUid);
      if (result.status === 'pending') {
        await this.technicalArticleAdditionsService.update(item.id, {
          state: TechnicalArticleAdditionState.RUNNING,
        });
        continue;
      }

      if (result.status === 'error') {
        const tries = item.tries + 1;
        if (tries >= 3) {
          await this.technicalArticleAdditionsService.update(item.id, {
            state: TechnicalArticleAdditionState.ERROR,
            tries,
            message: result.message,
          });
          await this.notifyUniquenessError(item.articleId);
        } else {
          await this.technicalArticleAdditionsService.update(item.id, {
            state: TechnicalArticleAdditionState.PENDING,
            tries,
            message: result.message,
          });
        }
        continue;
      }

      const percent = result.unique.replace(',', '.');
      await this.articlesService.updateAddition(
        item.articleId,
        ArticleAdditionType.ARTICLE_UNIQ_CHECK,
        percent,
      );
      await this.technicalArticleAdditionsService.update(item.id, {
        state: TechnicalArticleAdditionState.FINISHED,
        message: null,
      });
      await this.notifyUniquenessFinished(item.articleId, percent);
    }
  }

  private extractTextUid(technicalInfo?: string | null): string | null {
    if (!technicalInfo) return null;
    try {
      const parsed = JSON.parse(technicalInfo) as { textUid?: string };
      if (parsed?.textUid) return parsed.textUid;
    } catch {
      if (technicalInfo.trim().length > 0) {
        return technicalInfo.trim();
      }
    }
    return null;
  }

  private async notifyUniquenessFinished(articleId: string, percent: string) {
    const article = await this.articlesService.findById(articleId);
    if (!article) return;
    const user = await this.usersService.findById(article.userId);
    if (!user?.telegramId) return;
    await this.bot.api.sendMessage(
      Number(user.telegramId),
      this.localesService.t('article.uniqueness_check_finished', { percent }) ||
        `Результат проверки готов. Уникальность текста: ${percent}%`,
    );
  }

  private async notifyUniquenessError(articleId: string) {
    const article = await this.articlesService.findById(articleId);
    if (!article) return;
    const user = await this.usersService.findById(article.userId);
    if (!user?.telegramId) return;
    await this.bot.api.sendMessage(
      Number(user.telegramId),
      this.localesService.t('article.uniqueness_check_error') ||
        'Возникла техническая ошибка в процессе проверки уникальности, обратитесь к администратору системы за подробностями.',
    );
  }

  private async handleRegenerate(ctx: Context) {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return;
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) return;

    const state = await this.getUserState(user.id);

    if (state === 'WAITING_FOR_FACT_CHECK_CONFIRMATION') {
      await this.handleFactCheckGeneration(ctx);
    } else if (state === 'WAITING_FOR_REWRITE_CONFIRMATION') {
      await this.handleFactCheckRewrite(ctx);
    } else {
      await ctx.answerCallbackQuery();
    }
  }
}
