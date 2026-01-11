/**
 * Type declarations for vectra package.
 * The package is missing .d.ts files in the published npm release.
 */

declare module 'vectra' {
  export type MetadataTypes = number | string | boolean;

  export interface MetadataFilter {
    $eq?: number | string | boolean;
    $ne?: number | string | boolean;
    $gt?: number;
    $gte?: number;
    $lt?: number;
    $lte?: number;
    $in?: (number | string)[];
    $nin?: (number | string)[];
    $and?: MetadataFilter[];
    $or?: MetadataFilter[];
    [key: string]: unknown;
  }

  export interface IndexItem<TMetadata = Record<string, MetadataTypes>> {
    id: string;
    metadata: TMetadata;
    vector: number[];
    norm: number;
    metadataFile?: string;
  }

  export interface IndexStats {
    version: number;
    metadata_config: {
      indexed?: string[];
    };
    items: number;
  }

  export interface QueryResult<TMetadata = Record<string, MetadataTypes>> {
    item: IndexItem<TMetadata>;
    score: number;
  }

  export interface CreateIndexConfig {
    version: number;
    deleteIfExists?: boolean;
    metadata_config?: {
      indexed?: string[];
    };
  }

  export class LocalIndex<
    TMetadata extends Record<string, MetadataTypes> = Record<string, MetadataTypes>,
  > {
    constructor(folderPath: string, indexName?: string);

    get folderPath(): string;
    get indexName(): string;

    beginUpdate(): Promise<void>;
    cancelUpdate(): void;
    endUpdate(): Promise<void>;

    createIndex(config?: CreateIndexConfig): Promise<void>;
    deleteIndex(): Promise<void>;
    isIndexCreated(): Promise<boolean>;

    getIndexStats(): Promise<IndexStats>;
    getItem<TItemMetadata extends TMetadata = TMetadata>(
      id: string
    ): Promise<IndexItem<TItemMetadata> | undefined>;

    insertItem<TItemMetadata extends TMetadata = TMetadata>(
      item: Partial<IndexItem<TItemMetadata>>
    ): Promise<IndexItem<TItemMetadata>>;

    batchInsertItems<TItemMetadata extends TMetadata = TMetadata>(
      items: Partial<IndexItem<TItemMetadata>>[]
    ): Promise<IndexItem<TItemMetadata>[]>;

    upsertItem<TItemMetadata extends TMetadata = TMetadata>(
      item: Partial<IndexItem<TItemMetadata>>
    ): Promise<IndexItem<TItemMetadata>>;

    deleteItem(id: string): Promise<void>;

    listItems<TItemMetadata extends TMetadata = TMetadata>(): Promise<IndexItem<TItemMetadata>[]>;

    listItemsByMetadata<TItemMetadata extends TMetadata = TMetadata>(
      filter: MetadataFilter
    ): Promise<IndexItem<TItemMetadata>[]>;

    queryItems<TItemMetadata extends TMetadata = TMetadata>(
      vector: number[],
      query: string,
      topK: number,
      filter?: MetadataFilter,
      isBm25?: boolean
    ): Promise<QueryResult<TItemMetadata>[]>;
  }
}
