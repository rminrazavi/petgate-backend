import type { Schema, Struct } from '@strapi/strapi';

export interface BundleBundleComponentSnapshot extends Struct.ComponentSchema {
  collectionName: 'components_bundle_component_snapshots';
  info: {
    displayName: 'Bundle Component Snapshot';
    icon: 'archive';
  };
  attributes: {
    nameSnapshot: Schema.Attribute.String;
    quantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    sku: Schema.Attribute.String;
    unitPriceAtPurchase: Schema.Attribute.Decimal & Schema.Attribute.Required;
    variantId: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface BundleOrderItemSnapshot extends Struct.ComponentSchema {
  collectionName: 'components_bundle_order_item_snapshots';
  info: {
    displayName: 'Bundle Order Item Snapshot';
    icon: 'archive';
  };
  attributes: {
    bundleNameSnapshot: Schema.Attribute.String & Schema.Attribute.Required;
    bundleSlugSnapshot: Schema.Attribute.String;
    components: Schema.Attribute.Component<
      'bundle.bundle-component-snapshot',
      true
    >;
  };
}

export interface CategoryCategoryLabels extends Struct.ComponentSchema {
  collectionName: 'components_category_category_labels';
  info: {
    displayName: 'categoryLabels';
  };
  attributes: {
    label: Schema.Attribute.String;
    parentCategory: Schema.Attribute.String;
  };
}

export interface EditorialSection extends Struct.ComponentSchema {
  collectionName: 'components_editorial_sections';
  info: {
    displayName: 'Editorial section';
    icon: 'layout';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    ctaHref: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    ctaLabel: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    description: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1200;
      }>;
    eyebrow: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    title: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
  };
}

export interface EditorialUtilityItem extends Struct.ComponentSchema {
  collectionName: 'components_editorial_utility_items';
  info: {
    displayName: 'Utility bar item';
    icon: 'information';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    href: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    order: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface FooterLink extends Struct.ComponentSchema {
  collectionName: 'components_footer_links';
  info: {
    displayName: 'Footer link';
    icon: 'link';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    category: Schema.Attribute.Relation<'oneToOne', 'api::category.category'>;
    external: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    href: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    order: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface HomeActivityCards extends Struct.ComponentSchema {
  collectionName: 'components_home_activity_cards';
  info: {
    displayName: 'activity_cards';
  };
  attributes: {
    action: Schema.Attribute.String;
    active: Schema.Attribute.Boolean;
    description: Schema.Attribute.String;
    icon: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    link: Schema.Attribute.String;
    sortOrder: Schema.Attribute.Integer;
    title: Schema.Attribute.String;
  };
}

export interface NavigationItem extends Struct.ComponentSchema {
  collectionName: 'components_navigation_items';
  info: {
    displayName: 'Navigation item';
    icon: 'bulletList';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    category: Schema.Attribute.Relation<'oneToOne', 'api::category.category'>;
    children: Schema.Attribute.Component<'navigation.sub-item', true>;
    external: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    href: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    icon: Schema.Attribute.Media<'images'>;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    order: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface NavigationSubItem extends Struct.ComponentSchema {
  collectionName: 'components_navigation_sub_items';
  info: {
    displayName: 'Navigation child';
    icon: 'link';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    category: Schema.Attribute.Relation<'oneToOne', 'api::category.category'>;
    external: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    href: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    order: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface PetCare extends Struct.ComponentSchema {
  collectionName: 'components_pet_cares';
  info: {
    displayName: 'Care';
  };
  attributes: {
    lastDeworming: Schema.Attribute.Date;
    lastGrooming: Schema.Attribute.Date;
    lastVaccination: Schema.Attribute.Date;
    lastVetVisit: Schema.Attribute.Date;
    specialCare: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1000;
      }>;
  };
}

export interface PetMedicalHistory extends Struct.ComponentSchema {
  collectionName: 'components_pet_medical_histories';
  info: {
    displayName: 'Medical history';
  };
  attributes: {
    description: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1000;
      }>;
    disease: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    endDate: Schema.Attribute.Date;
    startDate: Schema.Attribute.Date;
    status: Schema.Attribute.Enumeration<['ongoing', 'managed', 'recovered']>;
  };
}

export interface PetNamedItem extends Struct.ComponentSchema {
  collectionName: 'components_pet_named_items';
  info: {
    displayName: 'Named item';
  };
  attributes: {
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
  };
}

export interface PetNutrition extends Struct.ComponentSchema {
  collectionName: 'components_pet_nutritions';
  info: {
    displayName: 'Nutrition';
  };
  attributes: {
    currentFood: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    dietType: Schema.Attribute.Enumeration<
      ['dry', 'wet', 'mixed', 'raw', 'homemade', 'medical', 'other']
    >;
    foodAllergies: Schema.Attribute.Component<'pet.named-item', true>;
    forbiddenFoods: Schema.Attribute.Component<'pet.named-item', true>;
    mealsPerDay: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 20;
          min: 0;
        },
        number
      >;
  };
}

export interface ProductAttribute extends Struct.ComponentSchema {
  collectionName: 'components_product_attributes';
  info: {
    displayName: 'Attribute';
    icon: 'sliders';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ProductSpecification extends Struct.ComponentSchema {
  collectionName: 'components_product_specifications';
  info: {
    displayName: 'Specification';
    icon: 'list';
  };
  attributes: {
    title: Schema.Attribute.String & Schema.Attribute.Required;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    displayName: 'seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text;
    metaTitle: Schema.Attribute.String;
  };
}

export interface SiteLink extends Struct.ComponentSchema {
  collectionName: 'components_site_links';
  info: {
    displayName: 'Site link';
    icon: 'link';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    external: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    href: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    icon: Schema.Attribute.Media<'images'>;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    order: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface SiteTrustItem extends Struct.ComponentSchema {
  collectionName: 'components_site_trust_items';
  info: {
    displayName: 'Trust item';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    description: Schema.Attribute.String;
    icon: Schema.Attribute.Enumeration<
      ['shield', 'truck', 'payment', 'support', 'return']
    >;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String;
  };
}

export interface SiteTrustSymbol extends Struct.ComponentSchema {
  collectionName: 'components_site_trust_symbols';
  info: {
    description: 'A real certification or payment-trust seal shown in the footer (e-Namad, Digipay). Distinct from site.trust-item, which is an icon-and-text service promise, not a certification.';
    displayName: 'Trust symbol';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    enamadCode: Schema.Attribute.String;
    enamadId: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images'>;
    order: Schema.Attribute.Integer;
    provider: Schema.Attribute.Enumeration<
      ['enamad', 'digipay', 'samandehi', 'other']
    > &
      Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    verificationUrl: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'bundle.bundle-component-snapshot': BundleBundleComponentSnapshot;
      'bundle.order-item-snapshot': BundleOrderItemSnapshot;
      'category.category-labels': CategoryCategoryLabels;
      'editorial.section': EditorialSection;
      'editorial.utility-item': EditorialUtilityItem;
      'footer.link': FooterLink;
      'home.activity-cards': HomeActivityCards;
      'navigation.item': NavigationItem;
      'navigation.sub-item': NavigationSubItem;
      'pet.care': PetCare;
      'pet.medical-history': PetMedicalHistory;
      'pet.named-item': PetNamedItem;
      'pet.nutrition': PetNutrition;
      'product.attribute': ProductAttribute;
      'product.specification': ProductSpecification;
      'shared.seo': SharedSeo;
      'site.link': SiteLink;
      'site.trust-item': SiteTrustItem;
      'site.trust-symbol': SiteTrustSymbol;
    }
  }
}
