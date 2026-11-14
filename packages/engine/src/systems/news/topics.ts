/**
 * News topics: the content keys a story's text is written under.
 *
 * A topic owns two keys, `news.<topic>.headline` and `news.<topic>.body`, and lists the parameter
 * names its text may use. The engine stores only the keys and parameters; the web catalog writes
 * the words at display time. Registering every topic here lets a test check that the catalog has
 * text for each one and uses only declared parameters, and lets `postNews` refuse a story whose
 * topic or parameters nobody declared.
 *
 * Keys follow `CONTENT_KEY_PATTERN`: lowercase letters, digits and hyphens per segment, so a topic
 * is `reign-milestone`, never `reignMilestone`. Design: docs/design/news.md#content-keys.
 */

import { CONTENT_KEY_PATTERN, parseContentKey, type ContentKey } from '../../core/content-key';
import { RegistryError } from '../../core/errors';

/** A parameter name: camelCase, like the parameters of every other templated text. */
export const NEWS_PARAM_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

export interface NewsTopicSpec {
  /** The parameter names the headline and body may use. */
  readonly params: readonly string[];
}

/** A registered topic with its two keys. */
export interface NewsTopic {
  readonly topic: string;
  readonly headlineKey: ContentKey;
  readonly bodyKey: ContentKey;
  readonly params: readonly string[];
}

const topics = new Map<string, NewsTopic>();

/** The headline and body keys of a topic, whether or not it is registered. */
export function newsTopicKeys(topic: string): { headline: string; body: string } {
  return { headline: `news.${topic}.headline`, body: `news.${topic}.body` };
}

function sameParams(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/**
 * Registers a news topic. Registering the same topic again with the same parameters does nothing,
 * so a module loaded twice is harmless. Returns a function that removes the topic (for tests).
 *
 * @throws RegistryError when the topic makes a key that breaks `CONTENT_KEY_PATTERN`, a parameter
 *   name is not camelCase or is listed twice, or the topic is already registered with other
 *   parameters.
 */
export function registerNewsTopic(topic: string, spec: NewsTopicSpec): () => void {
  const keys = newsTopicKeys(topic);
  if (!CONTENT_KEY_PATTERN.test(keys.headline) || !CONTENT_KEY_PATTERN.test(keys.body)) {
    throw new RegistryError(
      `News topic ${JSON.stringify(topic)} must be lowercase letters, digits and hyphens, such as "reign-milestone"`,
      { topic },
    );
  }
  const params = [...spec.params].sort();
  for (const [index, name] of params.entries()) {
    if (!NEWS_PARAM_PATTERN.test(name)) {
      throw new RegistryError(
        `News topic "${topic}": parameter ${JSON.stringify(name)} must be one camelCase word`,
        { topic, param: name },
      );
    }
    if (index > 0 && params[index - 1] === name) {
      throw new RegistryError(`News topic "${topic}": parameter "${name}" is listed twice`, {
        topic,
        param: name,
      });
    }
  }
  const existing = topics.get(topic);
  if (existing !== undefined) {
    if (sameParams(existing.params, params)) {
      return () => undefined;
    }
    throw new RegistryError(`News topic "${topic}" is already registered with other parameters`, {
      topic,
    });
  }
  const stored: NewsTopic = Object.freeze({
    topic,
    headlineKey: parseContentKey(keys.headline),
    bodyKey: parseContentKey(keys.body),
    params: Object.freeze(params),
  });
  topics.set(topic, stored);
  return () => {
    if (topics.get(topic) === stored) {
      topics.delete(topic);
    }
  };
}

/** The registered topic, or undefined. */
export function newsTopic(topic: string): NewsTopic | undefined {
  return topics.get(topic);
}

/** Every registered topic, in topic order. */
export function newsTopics(): NewsTopic[] {
  return [...topics.values()].sort((left, right) => (left.topic < right.topic ? -1 : 1));
}
