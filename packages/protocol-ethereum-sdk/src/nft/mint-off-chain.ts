import type { BigNumber, Binary, NftCollectionControllerApi, NftLazyMintControllerApi } from "@rarible/protocol-api-client"
import type { SimpleLazyNft } from "./sign-nft"
import { getTokenId } from "./get-token-id"
import { ERC1155Request, ERC721Request, MintOffChainResponse, MintResponseTypeEnum } from "./mint"

export async function mintOffChain(
	signNft: (nft: SimpleLazyNft<"signatures">) => Promise<Binary>,
	nftCollectionApi: NftCollectionControllerApi,
	nftLazyMintApi: NftLazyMintControllerApi,
	data: ERC721Request | ERC1155Request
): Promise<MintOffChainResponse> {
	const nftTokenId = await getTokenId(nftCollectionApi, data.collection.id, data.creators[0].account)
	const mintData = getMintOffChainData(data, nftTokenId.tokenId)
	const minted = await nftLazyMintApi.mintNftAsset({
		lazyNft: Object.assign({}, mintData, {
			tokenId: nftTokenId.tokenId,
			signatures: [await signNft(mintData)],
		}),
	})
	return {
		type: MintResponseTypeEnum.OFF_CHAIN,
		item: minted,
		owner: data.creators[0].account,
		nftTokenId,
		contract: minted.contract,
		itemId: `${minted.contract}:${nftTokenId.tokenId}`,
	}
}

function getMintOffChainData(data: ERC721Request | ERC1155Request, tokenId: BigNumber): SimpleLazyNft<"signatures"> {
	const base = {
		contract: data.collection.id,
		uri: data.uri,
		royalties: data.royalties,
		creators: data.creators,
		tokenId,
	}
	if ("supply" in data) {
		return Object.assign({}, base, {
			"@type": "ERC1155" as const,
			supply: data.supply,
		})
	}
	return Object.assign({}, base, {
		"@type": "ERC721" as const,
	})
}
