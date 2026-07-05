-- JavaScript / TypeScript / React / Next.js development plugins

-- Better TS/JS development experience
-- Provides auto-imports, refactoring, and more
vim.pack.add { 'https://github.com/pmizio/typescript-tools.nvim' }

require('typescript-tools').setup {
  settings = {
    -- Separator for tsserver output
    tsserver_locale = 'en',
    -- Quickest way to get up and running
    tsserver_path = nil,
    -- Specify a custom tsconfig file (used for project-wide settings)
    tsserver_config_path = nil,
    -- Timeout in milliseconds for tsserver requests
    tsserver_max_memory = 256,
    -- Complete function calls
    complete_function_calls = true,
    -- Include completions for JSX attributes
    jsx_close_tag = {
      enable = true,
    },
  },
}

-- Wrap/unwrap arrow functions, add/remove async/await, etc.
-- Usage: <leader>ca for code actions
vim.keymap.set('n', '<leader>co', '<cmd>TSToolsOrganizeImports<CR>', { desc = '[T]ypeScript [O]rganize Imports' })
vim.keymap.set('n', '<leader>cf', '<cmd>TSToolsFixAll<CR>', { desc = '[T]ypeScript [F]ix All' })
vim.keymap.set('n', '<leader>cr', '<cmd>TSToolsRenameFile<CR>', { desc = '[T]ypeScript [R]ename File' })
