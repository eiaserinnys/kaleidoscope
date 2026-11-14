// 이 파일은 crates/contract/src/data.rs의 ui_tables 시험이 만든다. 손으로 고치지 않는다.
//
// 가짜 코어가 앱 정의에 serde 기본값을 채울 때 쓰는 표와, 그 표를 대조하는 견본이다.

import type { JsonValue } from "./serde_json/JsonValue";

export interface DefaultVariant {
  /** 판별자 필드 이름. 없으면 값의 모양으로 고른다. */
  key?: string;
  /** 판별자 값. */
  const?: string;
  node: DefaultNode;
}

export interface DefaultNode {
  /** 이 자리의 serde 기본값. */
  default?: JsonValue;
  /** 다른 정의를 가리킨다. */
  ref?: string;
  /** 객체의 칸. */
  properties?: Record<string, DefaultNode>;
  /** 사전 값(additionalProperties). */
  values?: DefaultNode;
  /** 배열 원소. */
  items?: DefaultNode;
  /** null과 묶인 anyOf. */
  option?: DefaultNode;
  /** const로 가르는 oneOf/anyOf. */
  variants?: DefaultVariant[];
}

export const DEFINITION_DEFAULTS: DefaultNode = {
  "properties": {
    "requires": {
      "ref": "Requires"
    },
    "permissions": {
      "default": []
    },
    "state": {
      "default": {}
    },
    "file_drop": {
      "option": {
        "ref": "PickFilesSpec"
      }
    },
    "sources": {
      "values": {
        "ref": "SourceDecl"
      }
    },
    "client": {
      "option": {
        "ref": "ClientDecl"
      }
    },
    "shortcuts": {
      "items": {
        "ref": "Shortcut"
      }
    },
    "settings": {
      "option": {
        "ref": "SettingsDecl"
      }
    },
    "ui": {
      "ref": "Block"
    }
  }
};

export const DEFINITION_DEFAULT_DEFS: Record<string, DefaultNode> = {
  "Action": {
    "variants": [
      {
        "node": {
          "ref": "PickFilesAction"
        }
      }
    ]
  },
  "Actions": {
    "variants": [
      {
        "node": {
          "ref": "PickFilesAction"
        }
      },
      {
        "node": {
          "items": {
            "ref": "Action"
          }
        }
      }
    ]
  },
  "Block": {
    "variants": [
      {
        "key": "type",
        "const": "repeat",
        "node": {
          "properties": {
            "layout": {
              "default": "column"
            },
            "virtual": {
              "default": false
            },
            "template": {
              "ref": "Block"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "when",
        "node": {
          "properties": {
            "child": {
              "ref": "Block"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "dialog",
        "node": {
          "properties": {
            "on_confirm": {
              "option": {
                "ref": "Actions"
              }
            },
            "child": {
              "ref": "Block"
            },
            "on_close": {
              "ref": "Actions"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "tour",
        "node": {
          "properties": {
            "on_step": {
              "ref": "Actions"
            },
            "on_close": {
              "ref": "Actions"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "anchor",
        "node": {
          "properties": {
            "child": {
              "ref": "Block"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "canvas",
        "node": {
          "properties": {
            "fit": {
              "default": "contain"
            },
            "on_pointer": {
              "option": {
                "ref": "Actions"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "timeline",
        "node": {
          "properties": {
            "on_viewport": {
              "option": {
                "ref": "Actions"
              }
            },
            "read_only": {
              "default": false
            },
            "on_seek": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_edit": {
              "option": {
                "ref": "Actions"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "slider",
        "node": {
          "properties": {
            "on_change": {
              "ref": "Actions"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "color",
        "node": {
          "properties": {
            "on_change": {
              "ref": "Actions"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "split",
        "node": {
          "properties": {
            "children": {
              "items": {
                "ref": "Block"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "tree",
        "node": {
          "properties": {
            "by": {
              "default": "children"
            },
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_check": {
              "option": {
                "ref": "Actions"
              }
            },
            "item_menu": {
              "items": {
                "ref": "ItemMenuEntry"
              }
            },
            "on_edit": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_edit_cancel": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_move": {
              "option": {
                "ref": "Actions"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "folder",
        "node": {
          "properties": {
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "chat",
        "node": {
          "properties": {
            "footer": {
              "option": {
                "ref": "Block"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "web_view",
        "node": {
          "properties": {
            "address_bar": {
              "default": false
            }
          }
        }
      },
      {
        "key": "type",
        "const": "stack",
        "node": {
          "properties": {
            "gap": {
              "default": "medium"
            },
            "children": {
              "items": {
                "ref": "Block"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "tabs",
        "node": {
          "properties": {
            "tabs": {
              "items": {
                "ref": "Tab"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "toolbar",
        "node": {
          "properties": {
            "start": {
              "items": {
                "ref": "Block"
              }
            },
            "end": {
              "items": {
                "ref": "Block"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "section",
        "node": {
          "properties": {
            "collapsible": {
              "default": false
            },
            "collapsed": {
              "default": false
            },
            "actions": {
              "items": {
                "ref": "Block"
              }
            },
            "menu": {
              "items": {
                "ref": "ItemMenuEntry"
              }
            },
            "on_edit": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_edit_cancel": {
              "option": {
                "ref": "Actions"
              }
            },
            "child": {
              "ref": "Block"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "list",
        "node": {
          "properties": {
            "layout": {
              "default": "rows"
            },
            "grouped": {
              "default": false
            },
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_activate": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_remove": {
              "option": {
                "ref": "Actions"
              }
            },
            "group_actions": {
              "items": {
                "ref": "GroupAction"
              }
            },
            "item_menu": {
              "items": {
                "ref": "ItemMenuEntry"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "table",
        "node": {
          "properties": {
            "columns": {
              "ref": "TableColumns"
            },
            "sort": {
              "option": {
                "ref": "SortSpec"
              }
            },
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            },
            "item_menu": {
              "items": {
                "ref": "ItemMenuEntry"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "properties",
        "node": {
          "properties": {
            "fields": {
              "items": {
                "ref": "PropertyField"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "feed",
        "node": {
          "properties": {
            "grouped": {
              "default": false
            },
            "format": {
              "default": "plain"
            },
            "follow": {
              "default": false
            },
            "columns": {
              "default": false
            },
            "copy": {
              "default": false
            },
            "collapsible": {
              "default": false
            },
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            },
            "item_menu": {
              "items": {
                "ref": "ItemMenuEntry"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "text",
        "node": {
          "properties": {
            "on_click": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_double_click": {
              "option": {
                "ref": "Actions"
              }
            },
            "format": {
              "default": "plain"
            },
            "style": {
              "default": "body"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "input",
        "node": {
          "properties": {
            "on_cancel": {
              "option": {
                "ref": "Actions"
              }
            },
            "on_change": {
              "ref": "Actions"
            },
            "kind": {
              "default": "text"
            },
            "multiline": {
              "default": false
            },
            "on_submit": {
              "option": {
                "ref": "Actions"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "select",
        "node": {
          "properties": {
            "on_change": {
              "ref": "Actions"
            },
            "style": {
              "default": "dropdown"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "toggle",
        "node": {
          "properties": {
            "on_change": {
              "ref": "Actions"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "notice",
        "node": {
          "properties": {
            "kind": {
              "default": "info"
            },
            "actions": {
              "default": [],
              "items": {
                "ref": "NoticeAction"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "button",
        "node": {
          "properties": {
            "icon_only": {
              "default": false
            },
            "variant": {
              "default": "default"
            },
            "on_click": {
              "ref": "Actions"
            },
            "preview": {
              "option": {
                "ref": "Block"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "image",
        "node": {
          "properties": {
            "fit": {
              "default": "contain"
            },
            "zoom": {
              "default": false
            }
          }
        }
      },
      {
        "key": "type",
        "const": "media",
        "node": {
          "properties": {
            "autoplay": {
              "default": false
            }
          }
        }
      },
      {
        "key": "type",
        "const": "button_grid",
        "node": {
          "properties": {
            "on_press": {
              "ref": "Actions"
            }
          }
        }
      },
      {
        "key": "type",
        "const": "chart",
        "node": {
          "properties": {
            "kind": {
              "default": "line"
            },
            "height": {
              "default": "medium"
            },
            "number_format": {
              "option": {
                "ref": "NumberFormat"
              }
            },
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            }
          }
        }
      },
      {
        "key": "type",
        "const": "map",
        "node": {
          "properties": {
            "on_select": {
              "option": {
                "ref": "Actions"
              }
            },
            "height": {
              "default": "medium"
            }
          }
        }
      }
    ]
  },
  "ClientDecl": {
    "properties": {
      "inputs": {
        "default": {}
      },
      "outputs": {
        "default": {}
      },
      "actions": {
        "default": []
      },
      "commands": {
        "default": {},
        "values": {
          "ref": "Actions"
        }
      },
      "state_keys": {
        "default": []
      },
      "storage_entries": {
        "default": []
      }
    }
  },
  "Column": {
    "properties": {
      "width": {
        "default": "fill"
      },
      "format": {
        "default": "text"
      }
    }
  },
  "FileAccept": {
    "properties": {
      "extensions": {
        "default": []
      }
    }
  },
  "GroupAction": {
    "properties": {
      "on_click": {
        "ref": "Actions"
      }
    }
  },
  "ItemMenuEntry": {
    "properties": {
      "on_select": {
        "ref": "Actions"
      }
    }
  },
  "NoticeAction": {
    "properties": {
      "on_click": {
        "ref": "Actions"
      }
    }
  },
  "NumberFormat": {
    "properties": {
      "notation": {
        "default": "standard"
      },
      "style": {
        "default": "decimal"
      }
    }
  },
  "PageDecl": {
    "properties": {
      "items": {
        "default": ""
      }
    }
  },
  "PickFilesAction": {
    "properties": {
      "pick_files": {
        "ref": "PickFilesSpec"
      }
    }
  },
  "PickFilesSpec": {
    "properties": {
      "accept": {
        "items": {
          "ref": "FileAccept"
        }
      },
      "multiple": {
        "default": false
      }
    }
  },
  "PropertyField": {
    "properties": {
      "format": {
        "default": "text"
      }
    }
  },
  "Requires": {
    "properties": {
      "modules": {
        "default": {}
      }
    }
  },
  "SettingsDecl": {
    "properties": {
      "ui": {
        "ref": "Block"
      }
    }
  },
  "Shortcut": {
    "properties": {
      "modifiers": {
        "default": []
      },
      "action": {
        "ref": "Actions"
      }
    }
  },
  "SortSpec": {
    "properties": {
      "desc": {
        "default": false
      }
    }
  },
  "SourceDecl": {
    "variants": [
      {
        "key": "kind",
        "const": "request",
        "node": {
          "properties": {
            "format": {
              "default": "json"
            },
            "page": {
              "option": {
                "ref": "PageDecl"
              }
            }
          }
        }
      },
      {
        "key": "kind",
        "const": "file",
        "node": {
          "properties": {
            "format": {
              "default": "json"
            }
          }
        }
      },
      {
        "key": "kind",
        "const": "folder",
        "node": {
          "properties": {
            "recursive": {
              "default": false
            }
          }
        }
      }
    ]
  },
  "Tab": {
    "properties": {
      "child": {
        "ref": "Block"
      }
    }
  },
  "TableColumns": {
    "variants": [
      {
        "node": {
          "items": {
            "ref": "Column"
          }
        }
      }
    ]
  }
};

/** serde 기본값을 채우기 전의 정의. */
export const DEFINITION_DEFAULTS_SAMPLE: unknown = {
  "id": "sample",
  "name": "sample",
  "requires": {
    "blocks": 63,
    "modules": {
      "files": 4,
      "agent": 4,
      "web": 1,
      "connection": 3,
      "storage": 3,
      "assets": 1,
      "http": 3,
      "worker": 1,
      "profiler": 1,
      "client": 7,
      "process": 2,
      "store": 4,
      "shell": 2
    }
  },
  "ui": {
    "type": "stack",
    "direction": "column",
    "children": [
      {
        "type": "repeat",
        "items": {
          "expr": "1"
        },
        "key": "sample",
        "template": {
          "type": "text",
          "value": {
            "expr": "1"
          }
        }
      },
      {
        "type": "when",
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          }
        },
        "value": {
          "expr": "true"
        }
      },
      {
        "type": "dialog",
        "open": {
          "expr": "1"
        },
        "title": {
          "expr": "1"
        },
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          }
        },
        "on_close": {
          "set_state": "sample"
        }
      },
      {
        "type": "tour",
        "open": {
          "expr": "1"
        },
        "step": {
          "expr": "1"
        },
        "steps": [
          {
            "key": "sample",
            "target": "sample",
            "title": {
              "expr": "1"
            },
            "body": {
              "expr": "1"
            }
          }
        ],
        "on_step": {
          "set_state": "sample"
        },
        "on_close": {
          "set_state": "sample"
        }
      },
      {
        "type": "anchor",
        "id": "sample",
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          }
        }
      },
      {
        "type": "progress",
        "value": {
          "expr": "1"
        },
        "max": 100.0
      },
      {
        "type": "canvas",
        "surface": {
          "expr": "1"
        }
      },
      {
        "type": "timeline",
        "tracks": {
          "expr": "1"
        },
        "duration": {
          "expr": "10"
        },
        "position": {
          "expr": "0"
        }
      },
      {
        "type": "sandbox",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "slider",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "min": 0.0,
        "max": 100.0
      },
      {
        "type": "color",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        }
      },
      {
        "type": "split",
        "direction": "row",
        "children": [
          {
            "type": "text",
            "value": {
              "expr": "1"
            }
          },
          {
            "type": "text",
            "value": {
              "expr": "1"
            }
          }
        ]
      },
      {
        "type": "tree",
        "items": {
          "expr": "1"
        }
      },
      {
        "type": "folder",
        "root": {
          "permission": "sample"
        }
      },
      {
        "type": "markdown",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "html_view",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "chat"
      },
      {
        "type": "web_view",
        "url": {
          "state": "sample"
        }
      },
      {
        "type": "explorer",
        "root": {
          "permission": "sample"
        }
      },
      {
        "type": "stack",
        "direction": "row",
        "children": [
          {
            "type": "text",
            "value": {
              "expr": "1"
            }
          }
        ]
      },
      {
        "type": "tabs",
        "tabs": [
          {
            "label": {
              "expr": "1"
            },
            "child": {
              "type": "text",
              "value": {
                "expr": "1"
              }
            }
          }
        ]
      },
      {
        "type": "toolbar",
        "start": [
          {
            "type": "text",
            "value": {
              "expr": "1"
            }
          }
        ]
      },
      {
        "type": "section",
        "title": {
          "expr": "1"
        },
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          }
        }
      },
      {
        "type": "list",
        "items": {
          "expr": "1"
        }
      },
      {
        "type": "table",
        "rows": {
          "expr": "1"
        },
        "columns": {
          "expr": "1"
        }
      },
      {
        "type": "properties",
        "fields": [
          {
            "label": {
              "expr": "1"
            },
            "value": {
              "expr": "1"
            }
          }
        ]
      },
      {
        "type": "feed",
        "entries": {
          "expr": "1"
        }
      },
      {
        "type": "text",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "input",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        }
      },
      {
        "type": "select",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "options": {
          "expr": "1"
        }
      },
      {
        "type": "toggle",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "label": {
          "expr": "1"
        }
      },
      {
        "type": "notice",
        "message": {
          "expr": "1"
        }
      },
      {
        "type": "button",
        "label": {
          "expr": "1"
        },
        "on_click": {
          "set_state": "sample"
        }
      },
      {
        "type": "code",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "image",
        "src": {
          "expr": "1"
        }
      },
      {
        "type": "media",
        "src": {
          "expr": "1"
        }
      },
      {
        "type": "metrics",
        "items": {
          "expr": "1"
        }
      },
      {
        "type": "button_grid",
        "columns": 2,
        "buttons": {
          "expr": "1"
        },
        "on_press": {
          "set_state": "sample"
        }
      },
      {
        "type": "chart",
        "series": {
          "expr": "1"
        }
      },
      {
        "type": "map",
        "points": {
          "expr": "1"
        }
      }
    ]
  },
  "state": {
    "sample": 0
  },
  "sources": {
    "sample": {
      "kind": "folder",
      "permission": "sample"
    }
  },
  "storage": {
    "entries": [
      {
        "id": "sample",
        "key": "sample",
        "kind": "md",
        "default": "",
        "label": "sample",
        "presentation": "settings"
      },
      {
        "id": "thread",
        "key": "thread/{workspace_id}",
        "kind": "json",
        "schema": {
          "type": "object"
        },
        "default": {},
        "label": "sample",
        "presentation": "hidden"
      }
    ]
  },
  "worker": {
    "runtime": "python3",
    "code": "sample"
  },
  "permissions": [
    {
      "module": "files",
      "id": "sample",
      "access": "read",
      "label": "sample"
    },
    {
      "module": "connection",
      "id": "sample-agent",
      "connection": "sample",
      "access": "readwrite",
      "label": "sample"
    }
  ],
  "assets": [
    {
      "id": "sample",
      "version": 1
    }
  ],
  "client": {
    "runtime": "javascript",
    "entry": {
      "id": "sample",
      "version": 1
    }
  },
  "agent": {
    "protocol": "conversation-v1",
    "permission": "sample-agent",
    "base_path": "/conversation",
    "namespace": "sample",
    "profile": "sample",
    "collection": "sample",
    "model_order": [
      "sample"
    ],
    "selected_model": "sample",
    "title_template": "sample",
    "initial_instruction_template": "sample",
    "instructions_template": "sample",
    "thread_entry": "thread"
  }
};

/** 코어가 그 견본을 읽어 내놓은 정의. */
export const DEFINITION_DEFAULTS_RESULT: unknown = {
  "id": "sample",
  "name": "sample",
  "requires": {
    "blocks": 63,
    "modules": {
      "agent": 4,
      "assets": 1,
      "client": 7,
      "connection": 3,
      "files": 4,
      "http": 3,
      "process": 2,
      "profiler": 1,
      "shell": 2,
      "storage": 3,
      "store": 4,
      "web": 1,
      "worker": 1
    }
  },
  "assets": [
    {
      "id": "sample",
      "version": 1
    }
  ],
  "permissions": [
    {
      "module": "files",
      "id": "sample",
      "access": "read",
      "label": "sample"
    },
    {
      "module": "connection",
      "id": "sample-agent",
      "connection": "sample",
      "access": "readwrite",
      "label": "sample"
    }
  ],
  "state": {
    "sample": 0
  },
  "sources": {
    "sample": {
      "kind": "folder",
      "permission": "sample",
      "recursive": false
    }
  },
  "storage": {
    "entries": [
      {
        "id": "sample",
        "key": "sample",
        "kind": "md",
        "default": "",
        "label": "sample",
        "presentation": "settings"
      },
      {
        "id": "thread",
        "key": "thread/{workspace_id}",
        "kind": "json",
        "schema": {
          "type": "object"
        },
        "default": {},
        "label": "sample",
        "presentation": "hidden"
      }
    ]
  },
  "agent": {
    "protocol": "conversation-v1",
    "permission": "sample-agent",
    "base_path": "/conversation",
    "namespace": "sample",
    "profile": "sample",
    "collection": "sample",
    "model_order": [
      "sample"
    ],
    "selected_model": "sample",
    "title_template": "sample",
    "initial_instruction_template": "sample",
    "instructions_template": "sample",
    "thread_entry": "thread"
  },
  "worker": {
    "runtime": "python3",
    "code": "sample"
  },
  "client": {
    "runtime": "javascript",
    "entry": {
      "id": "sample",
      "version": 1
    },
    "inputs": {},
    "outputs": {},
    "actions": [],
    "commands": {},
    "state_keys": [],
    "storage_entries": []
  },
  "ui": {
    "type": "stack",
    "direction": "column",
    "gap": "medium",
    "children": [
      {
        "type": "repeat",
        "items": {
          "expr": "1"
        },
        "key": "sample",
        "layout": "column",
        "virtual": false,
        "template": {
          "type": "text",
          "value": {
            "expr": "1"
          },
          "format": "plain",
          "style": "body"
        }
      },
      {
        "type": "when",
        "value": {
          "expr": "true"
        },
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          },
          "format": "plain",
          "style": "body"
        }
      },
      {
        "type": "dialog",
        "open": {
          "expr": "1"
        },
        "title": {
          "expr": "1"
        },
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          },
          "format": "plain",
          "style": "body"
        },
        "on_close": {
          "set_state": "sample"
        }
      },
      {
        "type": "tour",
        "open": {
          "expr": "1"
        },
        "step": {
          "expr": "1"
        },
        "steps": [
          {
            "key": "sample",
            "target": "sample",
            "title": {
              "expr": "1"
            },
            "body": {
              "expr": "1"
            }
          }
        ],
        "on_step": {
          "set_state": "sample"
        },
        "on_close": {
          "set_state": "sample"
        }
      },
      {
        "type": "anchor",
        "id": "sample",
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          },
          "format": "plain",
          "style": "body"
        }
      },
      {
        "type": "progress",
        "value": {
          "expr": "1"
        },
        "max": 100.0
      },
      {
        "type": "canvas",
        "surface": {
          "expr": "1"
        },
        "fit": "contain"
      },
      {
        "type": "timeline",
        "duration": {
          "expr": "10"
        },
        "position": {
          "expr": "0"
        },
        "tracks": {
          "expr": "1"
        },
        "read_only": false
      },
      {
        "type": "sandbox",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "slider",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "min": 0.0,
        "max": 100.0
      },
      {
        "type": "color",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        }
      },
      {
        "type": "split",
        "direction": "row",
        "children": [
          {
            "type": "text",
            "value": {
              "expr": "1"
            },
            "format": "plain",
            "style": "body"
          },
          {
            "type": "text",
            "value": {
              "expr": "1"
            },
            "format": "plain",
            "style": "body"
          }
        ]
      },
      {
        "type": "tree",
        "items": {
          "expr": "1"
        },
        "by": "children"
      },
      {
        "type": "folder",
        "root": {
          "permission": "sample"
        }
      },
      {
        "type": "markdown",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "html_view",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "chat"
      },
      {
        "type": "web_view",
        "url": {
          "state": "sample"
        },
        "address_bar": false
      },
      {
        "type": "explorer",
        "root": {
          "permission": "sample"
        }
      },
      {
        "type": "stack",
        "direction": "row",
        "gap": "medium",
        "children": [
          {
            "type": "text",
            "value": {
              "expr": "1"
            },
            "format": "plain",
            "style": "body"
          }
        ]
      },
      {
        "type": "tabs",
        "tabs": [
          {
            "label": {
              "expr": "1"
            },
            "child": {
              "type": "text",
              "value": {
                "expr": "1"
              },
              "format": "plain",
              "style": "body"
            }
          }
        ]
      },
      {
        "type": "toolbar",
        "start": [
          {
            "type": "text",
            "value": {
              "expr": "1"
            },
            "format": "plain",
            "style": "body"
          }
        ]
      },
      {
        "type": "section",
        "title": {
          "expr": "1"
        },
        "collapsible": false,
        "collapsed": false,
        "child": {
          "type": "text",
          "value": {
            "expr": "1"
          },
          "format": "plain",
          "style": "body"
        }
      },
      {
        "type": "list",
        "items": {
          "expr": "1"
        },
        "layout": "rows",
        "grouped": false
      },
      {
        "type": "table",
        "rows": {
          "expr": "1"
        },
        "columns": {
          "expr": "1"
        }
      },
      {
        "type": "properties",
        "fields": [
          {
            "label": {
              "expr": "1"
            },
            "value": {
              "expr": "1"
            },
            "format": "text"
          }
        ]
      },
      {
        "type": "feed",
        "entries": {
          "expr": "1"
        },
        "grouped": false,
        "format": "plain",
        "follow": false,
        "columns": false,
        "copy": false,
        "collapsible": false
      },
      {
        "type": "text",
        "value": {
          "expr": "1"
        },
        "format": "plain",
        "style": "body"
      },
      {
        "type": "input",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "kind": "text",
        "multiline": false
      },
      {
        "type": "select",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "options": {
          "expr": "1"
        },
        "style": "dropdown"
      },
      {
        "type": "toggle",
        "value": {
          "state": "sample"
        },
        "on_change": {
          "set_state": "sample"
        },
        "label": {
          "expr": "1"
        }
      },
      {
        "type": "notice",
        "message": {
          "expr": "1"
        },
        "kind": "info",
        "actions": []
      },
      {
        "type": "button",
        "label": {
          "expr": "1"
        },
        "icon_only": false,
        "variant": "default",
        "on_click": {
          "set_state": "sample"
        }
      },
      {
        "type": "code",
        "value": {
          "expr": "1"
        }
      },
      {
        "type": "image",
        "src": {
          "expr": "1"
        },
        "fit": "contain",
        "zoom": false
      },
      {
        "type": "media",
        "src": {
          "expr": "1"
        },
        "autoplay": false
      },
      {
        "type": "metrics",
        "items": {
          "expr": "1"
        }
      },
      {
        "type": "button_grid",
        "columns": 2,
        "buttons": {
          "expr": "1"
        },
        "on_press": {
          "set_state": "sample"
        }
      },
      {
        "type": "chart",
        "kind": "line",
        "series": {
          "expr": "1"
        },
        "height": "medium"
      },
      {
        "type": "map",
        "points": {
          "expr": "1"
        },
        "height": "medium"
      }
    ]
  }
};
