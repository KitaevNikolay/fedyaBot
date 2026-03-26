import { InfoCircleOutlined } from '@ant-design/icons';
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi } from '../shared/api/adminApi';
import type {
  AvailableModelOption,
  GenerationSetting,
  GenerationSettingsUpdatePayload,
  PromptDocumentSummary,
} from '../shared/types/admin';
import { formatNumber } from '../shared/utils/formatters';

type GenerationSettingDraft = {
  typeName: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  filesJson: string;
  additionalPayloadJson: string;
  systemPromptId: string | null;
  userPromptId: string | null;
};

const FIELD_HELP: Record<string, string> = {
  typeName:
    'Русское имя стадии. Используется в графиках, таблицах и фильтрах кабинета вместо технического type.',
  type: 'Технический ключ стадии генерации. По нему код выбирает шаблоны, плейсхолдеры и аналитику.',
  model:
    'Модель, которая будет вызвана в BotHub для этой стадии. Выбирайте через поиск: например, ввод claude отфильтрует только Claude-модели.',
  temperature:
    'Параметр случайности ответа модели. Чем ниже значение, тем стабильнее и предсказуемее результат. Обычно 0-0.3 для строгих задач, 0.4-0.8 для более гибкой генерации, выше 1.0 даёт больше вариативности и риска шума.',
  maxTokens:
    'Максимальный объём ответа модели. Если поставить слишком мало, генерация может обрезаться; слишком много увеличивает лимиты и стоимость.',
  files:
    'Список файлов или data-url, которые BotHub подставит в запрос к модели. Нужен для стадий, где модель должна видеть вложенный контекст.',
  systemPromptId:
    'ID системного промпта в Outline. Системный промпт задаёт правила поведения модели, ограничения и стиль ответа.',
  userPromptId:
    'ID пользовательского промпта в Outline. Это основной шаблон задачи, куда подставляются плейсхолдеры и данные статьи.',
  additionalPayload:
    'Дополнительные параметры запроса к BotHub. Позволяет переопределять плагины, провайдеров и другие поля API сверх базовой конфигурации.',
};

function stringifyJson(value: unknown, fallback: string) {
  if (value === null || value === undefined) {
    return fallback;
  }

  return JSON.stringify(value, null, 2);
}

function buildDraft(setting: GenerationSetting): GenerationSettingDraft {
  return {
    typeName: setting.typeName ?? '',
    model: setting.model,
    temperature: setting.temperature,
    maxTokens: setting.maxTokens,
    filesJson: stringifyJson(setting.files, '[]'),
    additionalPayloadJson: stringifyJson(setting.additionalPayload, ''),
    systemPromptId: setting.systemPromptId,
    userPromptId: setting.userPromptId,
  };
}

function mergePromptOptions(
  current: PromptDocumentSummary[],
  incoming: Array<PromptDocumentSummary | null | undefined>,
) {
  const promptMap = new Map(current.map((prompt) => [prompt.id, prompt]));

  for (const prompt of incoming) {
    if (!prompt) {
      continue;
    }

    promptMap.set(prompt.id, prompt);
  }

  return Array.from(promptMap.values()).sort((left, right) =>
    left.title.localeCompare(right.title, 'ru'),
  );
}

function parseIntegerInput(value?: string | number | null) {
  if (value === undefined || value === null) {
    return 0;
  }

  const normalized = String(value).replace(/[^\d-]/g, '');
  return Number(normalized || 0);
}

function formatIntegerInput(value?: string | number | null) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  const normalized = String(value).replace(/\s+/g, '');
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    return normalized;
  }

  return formatNumber(numericValue, {
    maximumFractionDigits: 0,
  });
}

function getPromptValue(
  promptId: string | null,
  promptOptions: PromptDocumentSummary[],
) {
  if (!promptId) {
    return null;
  }

  return (
    promptOptions.find((prompt) => prompt.id === promptId) ?? {
      id: promptId,
      title: promptId,
      url: null,
    }
  );
}

function renderLabel(title: string, helpKey: keyof typeof FIELD_HELP) {
  return (
    <span className="settings-field-label">
      <span>{title}</span>
      <Tooltip title={FIELD_HELP[helpKey]}>
        <InfoCircleOutlined className="settings-field-help" />
      </Tooltip>
    </span>
  );
}

export function GenerationSettingsPage() {
  const { message } = AntdApp.useApp();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollFrameRef = useRef<number | null>(null);
  const activeTypeRef = useRef<string | null>(null);
  const [settings, setSettings] = useState<GenerationSetting[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModelOption[]>([]);
  const [promptOptions, setPromptOptions] = useState<PromptDocumentSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, GenerationSettingDraft>>({});
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [savingTypes, setSavingTypes] = useState<string[]>([]);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await adminApi.getGenerationSettings();

        if (!isMounted) {
          return;
        }

        setSettings(response.settings);
        setPromptOptions(response.promptOptions);
        setDrafts(
          response.settings.reduce<Record<string, GenerationSettingDraft>>(
            (result, setting) => {
              result[setting.type] = buildDraft(setting);
              return result;
            },
            {},
          ),
        );
        setActiveType(response.settings[0]?.type ?? null);
        activeTypeRef.current = response.settings[0]?.type ?? null;
        setError(null);
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Не удалось загрузить настройки генерации.',
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadModels = async () => {
      try {
        const response = await adminApi.getGenerationSettingModels();

        if (!isMounted) {
          return;
        }

        setAvailableModels(response);
      } catch (requestError) {
        if (isMounted) {
          void message.warning(
            requestError instanceof Error
              ? `Список моделей BotHub не загрузился: ${requestError.message}`
              : 'Список моделей BotHub не загрузился.',
          );
        }
      } finally {
        if (isMounted) {
          setLoadingModels(false);
        }
      }
    };

    void loadModels();

    return () => {
      isMounted = false;
    };
  }, [message]);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container || settings.length === 0) {
      return;
    }

    const updateActiveType = () => {
      scrollFrameRef.current = null;
      const anchorLine = container.scrollTop + container.clientHeight * 0.35;
      let currentActive = settings[settings.length - 1]?.type ?? null;

      for (const setting of settings) {
        const element = sectionRefs.current[setting.type];

        if (!element) {
          continue;
        }

        const sectionTop = element.offsetTop;
        const sectionBottom = sectionTop + element.offsetHeight;

        if (anchorLine >= sectionTop && anchorLine < sectionBottom) {
          currentActive = setting.type;
          break;
        }

        if (anchorLine < sectionTop) {
          currentActive = setting.type;
          break;
        } else {
          currentActive = setting.type;
        }
      }

      if (activeTypeRef.current !== currentActive) {
        activeTypeRef.current = currentActive;
        setActiveType(currentActive);
      }
    };

    const handleScroll = () => {
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(updateActiveType);
    };

    updateActiveType();
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);

      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [settings]);

  const selectOptions = useMemo(
    () =>
      promptOptions.map((prompt) => ({
        value: prompt.id,
        label: prompt.title,
      })),
    [promptOptions],
  );

  const modelOptions = useMemo(() => {
    const modelMap = new Map<string, AvailableModelOption>();

    for (const model of availableModels) {
      modelMap.set(model.id, model);
    }

    for (const setting of settings) {
      if (!modelMap.has(setting.model)) {
        modelMap.set(setting.model, {
          id: setting.model,
          label: setting.model,
          provider: null,
        });
      }
    }

    return Array.from(modelMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label, 'en'),
    );
  }, [availableModels, settings]);

  const updateDraft = (
    type: string,
    patch: Partial<GenerationSettingDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [type]: {
        ...current[type],
        ...patch,
      },
    }));
  };

  const scrollToSetting = (type: string) => {
    const container = scrollContainerRef.current;
    const element = sectionRefs.current[type];

    if (!container || !element) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const targetTop =
      container.scrollTop + (elementRect.top - containerRect.top) - 8;

    container.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: 'auto',
    });
    activeTypeRef.current = type;
    setActiveType(type);
  };

  const saveSetting = async (setting: GenerationSetting) => {
    const draft = drafts[setting.type];

    if (!draft) {
      return;
    }

    if (!draft.model.trim()) {
      void message.error(`Для ${setting.type} нужно указать модель.`);
      return;
    }

    if (draft.temperature === null || !Number.isFinite(draft.temperature)) {
      void message.error(`Для ${setting.type} нужно указать temperature.`);
      return;
    }

    if (draft.maxTokens === null || !Number.isFinite(draft.maxTokens)) {
      void message.error(`Для ${setting.type} нужно указать max tokens.`);
      return;
    }

    let files: string[] = [];
    let additionalPayload: Record<string, unknown> | null = null;

    try {
      const parsedFiles = JSON.parse(draft.filesJson.trim() || '[]') as unknown;

      if (
        !Array.isArray(parsedFiles) ||
        parsedFiles.some((value) => typeof value !== 'string')
      ) {
        throw new Error('Поле Files должно быть JSON-массивом строк.');
      }

      files = parsedFiles.map((value) => value.trim());
    } catch (parseError) {
      void message.error(
        parseError instanceof Error
          ? parseError.message
          : 'Поле Files содержит невалидный JSON.',
      );
      return;
    }

    try {
      if (draft.additionalPayloadJson.trim()) {
        const parsedPayload = JSON.parse(draft.additionalPayloadJson) as unknown;

        if (
          parsedPayload !== null &&
          (typeof parsedPayload !== 'object' || Array.isArray(parsedPayload))
        ) {
          throw new Error(
            'Поле Additional payload должно быть JSON-объектом или null.',
          );
        }

        additionalPayload = parsedPayload as Record<string, unknown> | null;
      }
    } catch (parseError) {
      void message.error(
        parseError instanceof Error
          ? parseError.message
          : 'Поле Additional payload содержит невалидный JSON.',
      );
      return;
    }

    const payload: GenerationSettingsUpdatePayload = {
      typeName: draft.typeName.trim() || null,
      model: draft.model.trim(),
      temperature: draft.temperature,
      maxTokens: Math.trunc(draft.maxTokens),
      files,
      systemPromptId: draft.systemPromptId,
      userPromptId: draft.userPromptId,
      additionalPayload,
    };

    setSavingTypes((current) => [...current, setting.type]);

    try {
      const updated = await adminApi.updateGenerationSetting(setting.type, payload);

      setSettings((current) =>
        current.map((item) => (item.type === updated.type ? updated : item)),
      );
      setDrafts((current) => ({
        ...current,
        [updated.type]: buildDraft(updated),
      }));
      setPromptOptions((current) =>
        mergePromptOptions(current, [updated.systemPrompt, updated.userPrompt]),
      );
      setError(null);
      void message.success(`Настройки ${updated.type} сохранены.`);
    } catch (requestError) {
      void message.error(
        requestError instanceof Error
          ? requestError.message
          : `Не удалось сохранить настройки ${setting.type}.`,
      );
    } finally {
      setSavingTypes((current) =>
        current.filter((item) => item !== setting.type),
      );
    }
  };

  return (
    <div className="page-stack">
      <Typography.Paragraph className="section-lead">
        На странице собраны настройки из <code>GenerationSettings</code>. JSON
        можно редактировать в удобном виде с переносами строк, а при сохранении
        данные отправляются в структурированном виде и в базе сохраняются без
        лишних пробелов.
      </Typography.Paragraph>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Ошибка загрузки"
          description={error}
        />
      ) : null}

      {loading ? (
        <div className="chart-loading">
          <Spin />
        </div>
      ) : settings.length > 0 ? (
        <div className="generation-settings-shell">
          <div className="generation-settings-main">
            <div
              ref={scrollContainerRef}
              className="generation-settings-scroll"
            >
              <div className="generation-settings-stack">
                {settings.map((setting) => {
                  const draft = drafts[setting.type];

                  if (!draft) {
                    return null;
                  }

                  const currentSystemPrompt = getPromptValue(
                    draft.systemPromptId,
                    promptOptions,
                  );
                  const currentUserPrompt = getPromptValue(
                    draft.userPromptId,
                    promptOptions,
                  );
                  const isSaving = savingTypes.includes(setting.type);

                  return (
                    <div
                      key={setting.type}
                      ref={(node) => {
                        sectionRefs.current[setting.type] = node;
                      }}
                      className="generation-setting-anchor"
                    >
                      <Card
                        className="table-card generation-setting-card"
                        extra={
                          <Button
                            type="primary"
                            loading={isSaving}
                            onClick={() => void saveSetting(setting)}
                          >
                            Сохранить
                          </Button>
                        }
                      >
                        <Space
                          direction="vertical"
                          size={20}
                          className="settings-panel"
                        >
                          <div className="table-head generation-setting-head">
                            <div>
                              <Typography.Title level={4}>
                                {draft.typeName.trim() || setting.type}
                              </Typography.Title>
                              <Typography.Paragraph>
                                Технический тип: <code>{setting.type}</code>
                              </Typography.Paragraph>
                            </div>
                            <Space wrap>
                              <Tag color="processing">
                                {`${formatNumber(setting.placeholders.length, {
                                  maximumFractionDigits: 0,
                                })} плейсхолдеров`}
                              </Tag>
                              <Tag color="default">{setting.model}</Tag>
                            </Space>
                          </div>

                          <Form layout="vertical">
                            <Row gutter={[16, 16]}>
                              <Col xs={24} lg={8}>
                                <Form.Item label={renderLabel('Русское название стадии', 'typeName')}>
                                  <Input
                                    value={draft.typeName}
                                    onChange={(event) =>
                                      updateDraft(setting.type, {
                                        typeName: event.target.value,
                                      })
                                    }
                                    placeholder="Например, Генерация статьи"
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} lg={8}>
                                <Form.Item label={renderLabel('Тип генерации', 'type')}>
                                  <Input value={setting.type} disabled />
                                </Form.Item>
                              </Col>
                              <Col xs={24} lg={8}>
                                <Form.Item label={renderLabel('Модель', 'model')}>
                                  <Select
                                    showSearch
                                    value={draft.model}
                                    options={modelOptions.map((model) => ({
                                      value: model.id,
                                      label: model.provider
                                        ? `${model.label} (${model.provider})`
                                        : model.label,
                                    }))}
                                    loading={loadingModels}
                                    placeholder="Начните вводить название модели"
                                    filterOption={(input, option) =>
                                      `${String(option?.label ?? '')} ${String(
                                        option?.value ?? '',
                                      )}`
                                        .toLowerCase()
                                        .includes(input.toLowerCase())
                                    }
                                    onChange={(value) =>
                                      updateDraft(setting.type, {
                                        model: value,
                                      })
                                    }
                                  />
                                </Form.Item>
                              </Col>

                              <Col xs={24} md={12} lg={8}>
                                <Form.Item label={renderLabel('Temperature', 'temperature')}>
                                  <InputNumber
                                    className="settings-number-input"
                                    value={draft.temperature}
                                    min={0}
                                    max={2}
                                    step={0.1}
                                    onChange={(value) =>
                                      updateDraft(setting.type, {
                                        temperature:
                                          typeof value === 'number' ? value : null,
                                      })
                                    }
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} md={12} lg={8}>
                                <Form.Item label={renderLabel('Max tokens', 'maxTokens')}>
                                  <InputNumber
                                    className="settings-number-input"
                                    value={draft.maxTokens}
                                    min={0}
                                    step={100}
                                    formatter={formatIntegerInput}
                                    parser={parseIntegerInput}
                                    onChange={(value) =>
                                      updateDraft(setting.type, {
                                        maxTokens:
                                          typeof value === 'number' ? value : null,
                                      })
                                    }
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} lg={8}>
                                <Form.Item label={renderLabel('Files в базе', 'files')}>
                                  <Typography.Text type="secondary">
                                    JSON-массив строк. При сохранении
                                    сериализуется в минифицированный JSON.
                                  </Typography.Text>
                                </Form.Item>
                              </Col>

                              <Col xs={24} xl={12}>
                                <Form.Item label={renderLabel('Системный промпт', 'systemPromptId')}>
                                  <Select
                                    allowClear
                                    showSearch
                                    value={draft.systemPromptId ?? undefined}
                                    options={selectOptions}
                                    placeholder="Выберите документ Outline"
                                    filterOption={(input, option) =>
                                      `${String(option?.label ?? '')} ${String(
                                        option?.value ?? '',
                                      )}`
                                        .toLowerCase()
                                        .includes(input.toLowerCase())
                                    }
                                    onChange={(value) =>
                                      updateDraft(setting.type, {
                                        systemPromptId: value ?? null,
                                      })
                                    }
                                  />
                                  <div className="settings-prompt-meta">
                                    <Typography.Text type="secondary">
                                      {draft.systemPromptId
                                        ? `ID: ${draft.systemPromptId}`
                                        : 'ID не задан'}
                                    </Typography.Text>
                                    {currentSystemPrompt ? (
                                      currentSystemPrompt.url ? (
                                        <Typography.Link
                                          href={currentSystemPrompt.url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {currentSystemPrompt.title}
                                        </Typography.Link>
                                      ) : (
                                        <Typography.Text>
                                          {currentSystemPrompt.title}
                                        </Typography.Text>
                                      )
                                    ) : (
                                      <Typography.Text type="secondary">
                                        Документ не выбран
                                      </Typography.Text>
                                    )}
                                  </div>
                                </Form.Item>
                              </Col>
                              <Col xs={24} xl={12}>
                                <Form.Item label={renderLabel('Пользовательский промпт', 'userPromptId')}>
                                  <Select
                                    allowClear
                                    showSearch
                                    value={draft.userPromptId ?? undefined}
                                    options={selectOptions}
                                    placeholder="Выберите документ Outline"
                                    filterOption={(input, option) =>
                                      `${String(option?.label ?? '')} ${String(
                                        option?.value ?? '',
                                      )}`
                                        .toLowerCase()
                                        .includes(input.toLowerCase())
                                    }
                                    onChange={(value) =>
                                      updateDraft(setting.type, {
                                        userPromptId: value ?? null,
                                      })
                                    }
                                  />
                                  <div className="settings-prompt-meta">
                                    <Typography.Text type="secondary">
                                      {draft.userPromptId
                                        ? `ID: ${draft.userPromptId}`
                                        : 'ID не задан'}
                                    </Typography.Text>
                                    {currentUserPrompt ? (
                                      currentUserPrompt.url ? (
                                        <Typography.Link
                                          href={currentUserPrompt.url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {currentUserPrompt.title}
                                        </Typography.Link>
                                      ) : (
                                        <Typography.Text>
                                          {currentUserPrompt.title}
                                        </Typography.Text>
                                      )
                                    ) : (
                                      <Typography.Text type="secondary">
                                        Документ не выбран
                                      </Typography.Text>
                                    )}
                                  </div>
                                </Form.Item>
                              </Col>

                              <Col xs={24} xl={12}>
                                <Form.Item label={renderLabel('Files (JSON)', 'files')}>
                                  <Input.TextArea
                                    value={draft.filesJson}
                                    onChange={(event) =>
                                      updateDraft(setting.type, {
                                        filesJson: event.target.value,
                                      })
                                    }
                                    autoSize={{ minRows: 8, maxRows: 18 }}
                                    className="settings-json-input"
                                    placeholder='["https://..."]'
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} xl={12}>
                                <Form.Item label={renderLabel('Additional payload (JSON)', 'additionalPayload')}>
                                  <Input.TextArea
                                    value={draft.additionalPayloadJson}
                                    onChange={(event) =>
                                      updateDraft(setting.type, {
                                        additionalPayloadJson: event.target.value,
                                      })
                                    }
                                    autoSize={{ minRows: 8, maxRows: 18 }}
                                    className="settings-json-input"
                                    placeholder='{"plugins":[...]}'
                                  />
                                </Form.Item>
                              </Col>
                            </Row>
                          </Form>

                          <div className="generation-placeholder-section">
                            <Typography.Title level={5}>
                              Плейсхолдеры финального промпта
                            </Typography.Title>
                            <Typography.Paragraph>
                              Ниже показаны переменные, которые код
                              подставляет в шаблон перед отправкой генерации.
                            </Typography.Paragraph>
                            {setting.placeholders.length > 0 ? (
                              <div className="generation-placeholder-grid">
                                {setting.placeholders.map((placeholder) => (
                                  <div
                                    key={`${setting.type}-${placeholder.key}`}
                                    className="generation-placeholder-item"
                                  >
                                    <Tag color="processing">
                                      {placeholder.token}
                                    </Tag>
                                    <Typography.Text strong>
                                      {placeholder.label}
                                    </Typography.Text>
                                    <Typography.Text type="secondary">
                                      {placeholder.key}
                                    </Typography.Text>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="Для этой стадии плейсхолдеры в коде не описаны."
                              />
                            )}
                          </div>
                        </Space>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="generation-settings-outline">
            <Card className="table-card generation-settings-outline-card">
              <div className="table-head">
                <Typography.Title level={4}>Оглавление</Typography.Title>
                <Typography.Paragraph>
                  Быстрый переход к нужной стадии генерации.
                </Typography.Paragraph>
              </div>
              <div className="generation-settings-outline-scroll">
                {settings.map((setting) => {
                  const title =
                    drafts[setting.type]?.typeName.trim() || setting.type;

                  return (
                    <button
                      key={`outline-${setting.type}`}
                      type="button"
                      className={`generation-outline-button${
                        activeType === setting.type
                          ? ' generation-outline-button-active'
                          : ''
                      }`}
                      onClick={() => scrollToSetting(setting.type)}
                    >
                      <span className="generation-outline-title">{title}</span>
                      <span className="generation-outline-code">
                        {setting.type}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </aside>
        </div>
      ) : (
        <Empty description="Настройки генерации не найдены." />
      )}
    </div>
  );
}
