import { toAddress, toBigNumber } from "@rarible/types"
import { createE2eProvider } from "@rarible/ethereum-sdk-test-common"
import {
	Configuration,
	GatewayControllerApi,
	NftCollectionControllerApi,
	NftLazyMintControllerApi,
} from "@rarible/protocol-api-client"
import { retry } from "../common/retry"
import { mint, MintRequest } from "../nft/mint"
import { signNft } from "../nft/sign-nft"
import { send as sendTemplate } from "../common/send-transaction"
import { getApiConfig } from "../config/api-config"
import { createTestProviders } from "../common/create-test-providers"
import { checkAssetType as checkAssetTypeTemplate } from "./check-asset-type"

const { provider, wallet } = createE2eProvider()
const { providers } = createTestProviders(provider, wallet)
const from = toAddress(wallet.getAddressString())

describe.each(providers)("check-asset-type test", ethereum => {

	const e2eErc721ContractAddress = toAddress("0x22f8CE349A3338B15D7fEfc013FA7739F5ea2ff7")
	const configuration = new Configuration(getApiConfig("e2e"))
	const nftCollectionApi = new NftCollectionControllerApi(configuration)
	const nftLazyMintApi = new NftLazyMintControllerApi(configuration)
	const gatewayApi = new GatewayControllerApi(configuration)
	const sign = signNft.bind(null, ethereum, 17)
	const send = sendTemplate.bind(null, gatewayApi)
	const checkAssetType = checkAssetTypeTemplate.bind(null, nftCollectionApi)

	test("should set assetClass if type not present", async () => {
		const request: MintRequest = {
			uri: "uri",
			lazy: false,
			creators: [{ account: from, value: 10000 }],
			royalties: [],
			collection: {
				type: "ERC721",
				supportsLazyMint: true,
				id: e2eErc721ContractAddress,
			},
		}
		const minted = await mint(
			ethereum,
			send,
			sign,
			nftCollectionApi,
			nftLazyMintApi,
			request
		)

		await retry(10, async () => {
			const assetType = await checkAssetType({
				contract: e2eErc721ContractAddress,
				tokenId: toBigNumber(minted.tokenId),
			})
			expect(assetType.assetClass).toEqual("ERC721")
		})
	}, 50000)

	test("should leave as is if assetClass present", async () => {
		const request: MintRequest = {
			uri: "uri",
			creators: [{ account: from, value: 10000 }],
			royalties: [],
			lazy: false,
			collection: {
				type: "ERC721",
				supportsLazyMint: true,
				id: e2eErc721ContractAddress,
			},
		}
		const minted = await mint(
			ethereum,
			send,
			sign,
			nftCollectionApi,
			nftLazyMintApi,
			request
		)

		const assetType = await checkAssetType({
			assetClass: "ERC721",
			contract: e2eErc721ContractAddress,
			tokenId: toBigNumber(minted.tokenId),
		})
		expect(assetType.assetClass).toEqual("ERC721")
	}, 50000)
})
